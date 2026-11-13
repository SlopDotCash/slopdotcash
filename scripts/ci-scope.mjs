import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { listModels, modelSources } from "./formal-models.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;
// A trusted deploying push (main to production, development to staging) needs
// every gate. Both branches require the full CI, and a push event has no
// pull-request changed-file list to drive selective checks.
const full =
  process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
  (process.env.GITHUB_EVENT_NAME === "push" &&
    ["refs/heads/main", "refs/heads/development"].includes(
      process.env.GITHUB_REF,
    ));
const promotion =
  pr?.base.ref === "main" &&
  pr.head.ref === "development" &&
  pr.head.repo?.full_name === pr.base.repo?.full_name;
const files = pr
  ? execFileSync(
      "git",
      ["diff", "--name-only", "-z", `${pr.base.sha}...${pr.head.sha}`],
      {
        encoding: "utf8",
      },
    )
      .split("\0")
      .filter(Boolean)
  : [];
const changed = (pattern) => files.some((file) => pattern.test(file));
const workflow = changed(
  /^\.github\/workflows\/deploy\.yml$|^scripts\/ci-scope\.mjs$|^(package\.json|bun\.lock|vite\.config\.|tsconfig)/u,
);
const ui =
  full ||
  (!promotion &&
    (workflow ||
      changed(
        /^(src\/|public\/|tests\/e2e\/|scripts\/(run-e2e|prepare-e2e|prepare-site|prepare-publication|dist-manifest)|playwright\.config|index\.html$)/u,
      )));
// scripts/run-e2e.mjs runs the @registry specs only in the registry phase,
// with the fixture servers it starts there. A change to that runner, to shared
// browser fixtures, or to a spec carrying the tag needs the registry lanes.
const registryBrowser = files.some((file) =>
  /^tests\/e2e\/.*\.spec\.ts$/u.test(file)
    ? existsSync(file) && readFileSync(file, "utf8").includes("@registry")
    : /^(tests\/e2e\/|scripts\/(run-e2e|prepare-e2e)|playwright\.config|tests\/(github-api|notify-worker|slopbot-worker)-fixture\.mjs$)/u.test(
        file,
      ),
);
const api =
  full ||
  (!promotion &&
    (workflow ||
      registryBrowser ||
      changed(/^(backend\/|functions\/|migrations\/|workers\/)/u)));
const lane = (name, server, browsers, shard, grep = "") => ({
  lane: name,
  server,
  browsers,
  shard,
  grep,
});
const lanes = [];
if (ui)
  lanes.push(
    // Preview includes the draft and email identity cases in both engines.
    lane("preview-1", "preview", "chromium firefox", "1/2"),
    lane("preview-2", "preview", "chromium firefox", "2/2"),
    lane("pages", "pages", "chromium", "1/1"),
  );
// Root skill edits change raw Markdown and discovery bytes checked by Pages.
if (!ui && changed(/^skills\/slop\//u))
  lanes.push(lane("pages", "pages", "chromium", "1/1"));
if (api)
  lanes.push(
    lane("registry-1", "registry", "chromium firefox", "1/2"),
    lane("registry-2", "registry", "chromium firefox", "2/2"),
  );
if (!lanes.length)
  lanes.push(
    lane(
      "smoke",
      "preview",
      "chromium",
      "1/1",
      "retained awards URLs|serves GitHub login on direct navigation|funding resolves to the consolidated project page",
    ),
  );
const sandbox =
  full ||
  (!promotion &&
    changed(
      /^(workers\/(vetting|slopbot\/value-merge-)|backend\/(vetting\/|projects\/cloudflare-persistence|slopbot\/value-import)|scripts\/(vetting|value-merge-|prepare-vetting)|tests\/fixtures\/value-merge-sdk-|\.github\/workflows\/vetting-sandbox)/u,
    ));
const installer =
  full ||
  (!promotion &&
    changed(
      /^(skills\/|src\/lib\/(project-skill|project-schema|install-command)|scripts\/(skill-|.*install|prepare-site|prepare-publication|package-skill)|tests\/integration\/installer|package\.json|bun\.lock)/u,
    ));
// State models and LemmaScript proofs. Trusted pushes, manual runs and
// promotions check every model and proof. A pull request checks only what it
// can change. A Quint model imports nothing, so its result depends only on its
// own file, its `// @source` files and the tools check-formal.mjs hashes into
// every report. LemmaScript translates the manifest sources and the files they
// import, so it runs when one of those, a proof artifact or the prover setup
// changes. The formal and LemmaScript inventory checks run on every pull
// request either way.
const allProofs = !pr || full || promotion;
const changedFiles = new Set(files);
const formalTools = changed(
  /^(\.github\/workflows\/formal\.yml|scripts\/(ci-scope|check-formal|formal-models|formal-report|run-e2e-phase|quint-[\w-]+)\.mjs|formal\/tlc(-safety-views)?\.json|package\.json|bun\.lock)$/u,
);
const modelName = (path) =>
  path.slice(path.lastIndexOf("/") + 1, -".qnt".length);
const formalModels =
  allProofs || formalTools
    ? "all"
    : (existsSync("formal/models") ? listModels(".") : [])
        .filter(
          (path) =>
            changedFiles.has(path) ||
            modelSources(readFileSync(path, "utf8")).some((source) =>
              changedFiles.has(source),
            ),
        )
        .map(modelName)
        .join(" ") || "none";
const selectedModels =
  formalModels === "all" || formalModels === "none"
    ? 0
    : formalModels.split(" ").length;
// About ten models per runner, at most the six shards of a complete run. A
// selection of none skips the model jobs; it still names one shard so the
// matrix is never empty.
const formalShards = JSON.stringify(
  Array.from(
    {
      length:
        formalModels === "all"
          ? 6
          : Math.max(1, Math.min(6, Math.ceil(selectedModels / 10))),
    },
    (_, index) => index + 1,
  ),
);
/** Proof sources plus every file they reach through relative imports. */
function proofInputs() {
  if (!existsSync("LemmaScript-files.txt")) return new Set();
  const pending = readFileSync("LemmaScript-files.txt", "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const seen = new Set();
  const isFile = (path) => existsSync(path) && statSync(path).isFile();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file) || !isFile(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/gu,
    )) {
      const target = normalize(join(dirname(file), specifier));
      const stem = target.replace(/\.(?:[cm]?js|jsx)$/u, "");
      const match = [
        target,
        ...[".ts", ".tsx", ".mts", ".js", ".mjs"].map((ext) => stem + ext),
        ...["index.ts", "index.tsx", "index.js"].map((name) =>
          join(target, name),
        ),
      ].find(isFile);
      if (match) pending.push(match);
    }
  }
  return seen;
}
const lemmascript =
  allProofs ||
  changed(
    /^(\.github\/workflows\/lemmascript\.yml|scripts\/(ci-scope\.mjs|check-lemmascript\.mjs|lemmascript-[\w-]+\.mjs|run-e2e-phase\.mjs|setup-lemmascript\.sh)|lemmascript\.json|LemmaScript-files\.txt|package\.json|bun\.lock|tsconfig[^/]*\.json)$|^formal\/lemmascript\//u,
  ) ||
  [...proofInputs()].some((path) => changedFiles.has(path));
for (const [key, value] of Object.entries({
  browser_matrix: JSON.stringify({ include: lanes }),
  formal_models: formalModels,
  formal_shards: formalShards,
  lemmascript,
  sandbox,
  installer,
  solana:
    !pr ||
    (!promotion &&
      changed(
        /^contracts\/solana\/|^backend\/(security|fee-conversions)\/|^backend\/projects\/vault-setup\.ts$|^workers\/(fee-converter|payment-executor|payments)\/|^migrations\/|^src\/lib\/security-bounty\.|^\.github\/workflows\/escrow-tests\.yml$|^scripts\/(ci-scope\.mjs$|local-solana-validator\.|escrow-acceptance(?:\/|\.ts$))|^tests\/(bounty-wallet-seed\.ts$|direct-bounty-solana-chain\.ts$|e2e\/(solana-vault-actions\.spec|award-month|project-maintainer-fixture|vault-setup-server)\.ts$)/u,
      )),
  evm:
    !pr ||
    (!promotion &&
      changed(
        /^contracts\/evm\/|^backend\/(security|payments|fee-conversions)\/|^backend\/projects\/vault-setup\.ts$|^workers\/(fee-converter|payment-executor|payments)\/|^migrations\/|^src\/lib\/security-bounty\.|^scripts\/(run-security-payments\.mjs$|escrow-acceptance(?:\/|\.ts$))|^\.github\/workflows\/escrow-tests\.yml$|^scripts\/ci-scope\.mjs$/u,
      )),
}))
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
console.log(
  JSON.stringify({
    files: files.length,
    promotion,
    lanes,
    sandbox,
    installer,
    formalModels,
    formalShards,
    lemmascript,
  }),
);

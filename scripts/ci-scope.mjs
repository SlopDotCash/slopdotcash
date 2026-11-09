import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

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
for (const [key, value] of Object.entries({
  browser_matrix: JSON.stringify({ include: lanes }),
  sandbox,
  installer,
  solana:
    !pr ||
    (!promotion &&
      changed(
        /^contracts\/solana\/|^backend\/(security|fee-conversions)\/|^workers\/fee-converter\/|^migrations\/|^src\/lib\/security-bounty\.|^\.github\/workflows\/escrow-tests\.yml$|^scripts\/(ci-scope\.mjs$|local-solana-validator\.|escrow-acceptance(?:\/|\.ts$))|^tests\/(bounty-wallet-seed\.ts$|direct-bounty-solana-chain\.ts$|e2e\/(solana-vault-actions\.spec|award-month|project-maintainer-fixture|vault-setup-server)\.ts$)/u,
      )),
  evm:
    !pr ||
    (!promotion &&
      changed(
        /^contracts\/evm\/|^backend\/(security|payments|fee-conversions)\/|^workers\/fee-converter\/|^migrations\/|^src\/lib\/security-bounty\.|^scripts\/(run-security-payments\.mjs$|escrow-acceptance(?:\/|\.ts$))|^\.github\/workflows\/escrow-tests\.yml$|^scripts\/ci-scope\.mjs$/u,
      )),
}))
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
console.log(
  JSON.stringify({ files: files.length, promotion, lanes, sandbox, installer }),
);

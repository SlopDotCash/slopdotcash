import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;
const full = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
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
        /^(src\/|public\/|tests\/e2e\/|scripts\/(run-e2e|prepare-e2e)|playwright\.config)/u,
      )));
const api =
  full ||
  (!promotion &&
    (workflow ||
      changed(
        /^(backend\/|functions\/|migrations\/|workers\/|tests\/e2e\/registry|tests\/e2e\/security-bounty)/u,
      )));
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
    lane("preview-1", "preview", "chromium", "1/2"),
    lane("preview-2", "preview", "chromium", "2/2"),
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
      "retained awards URLs|serves GitHub login on direct navigation|keeps /projects/eliza accessible",
    ),
  );
const sandbox =
  full ||
  (!promotion &&
    changed(
      /^(workers\/vetting|scripts\/(vetting|value-merge-sdk|prepare-vetting)|\.github\/workflows\/vetting-sandbox)/u,
    ));
const installer =
  full ||
  (!promotion &&
    changed(
      /^(skills\/|src\/lib\/project-skill|scripts\/(skill-|.*install|prepare-site|prepare-publication|package-skill)|tests\/integration\/installer|package\.json|bun\.lock)/u,
    ));
for (const [key, value] of Object.entries({
  browser_matrix: JSON.stringify({ include: lanes }),
  sandbox,
  installer,
  solana:
    !pr ||
    (!promotion &&
      changed(
        /^contracts\/solana\/|^\.github\/workflows\/escrow-tests\.yml$|^scripts\/ci-scope\.mjs$/u,
      )),
  evm:
    !pr ||
    (!promotion &&
      changed(
        /^contracts\/evm\/|^\.github\/workflows\/escrow-tests\.yml$|^scripts\/ci-scope\.mjs$/u,
      )),
}))
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
console.log(
  JSON.stringify({ files: files.length, promotion, lanes, sandbox, installer }),
);

// Executes the checked-in Linux dispatcher against a stateful GitHub CLI
// stand-in. Queue state is the result; no provider or live workflow is called.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const source = readFileSync(
  new URL("../.github/workflows/vetting-controller.yml", import.meta.url),
  "utf8",
);
const dispatcher = source
  .split("        run: |\n")[1]
  .split("\n  scan:")[0]
  .split("\n")
  .map((line) => line.slice(10))
  .join("\n");
const sha = "a".repeat(40);
const fixture = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const path = process.env.DISPATCH_STATE;
const state = JSON.parse(fs.readFileSync(path, "utf8"));
if(args[0] === "api") {
 if(args.includes("--slurp") && args.includes("--jq")) process.exit(2);
 const route = args[1];
 const head = route.match(/commits\\/heads\\/(main|development)$/);
 if(head) process.stdout.write(state.heads[head[1]]);
 else if(route.includes("workflows/deploy.yml/runs?")) {
  const ref = new URL("https://fixture.invalid/" + route).searchParams.get("branch");
  process.stdout.write(String(state.releases[ref] ?? ""));
 } else {
  const job = route.match(/actions\\/runs\\/(\\d+)\\/jobs/);
  if(!job) process.exit(7);
  const name = Number(job[1]) === 17
    ? "Deploy trusted production bundle"
    : "Deploy verified development to staging";
  process.stdout.write(JSON.stringify([
   { jobs: [{ name: "Other check", conclusion: "success" }] },
   { jobs: [{ name, conclusion: state.deployed.includes(Number(job[1])) ? "success" : "skipped" }] }
  ]));
 }
} else if(args[0] === "run" && args[1] === "list") {
 const ref = args[args.indexOf("--branch") + 1];
 process.stdout.write(state.active.includes(ref) ? "1" : "0");
} else if(args[0] === "workflow" && args[1] === "run") {
 if(state.failDispatch) process.exit(8);
 state.queued.push(args[args.indexOf("--ref") + 1]);
 fs.writeFileSync(path, JSON.stringify(state));
} else process.exit(9);
`;

test.skipIf(process.platform === "win32")(
  "release completion dispatches only a current deployed branch with no active scan",
  () => {
    for (const scenario of [
      { name: "production release", ref: "main", queue: ["main"] },
      { name: "staging release", ref: "development", queue: ["development"] },
      { name: "branch advanced", ref: "main", advanced: true, queue: [] },
      { name: "deployment skipped", ref: "main", skipped: true, queue: [] },
      { name: "scan active", ref: "main", active: true, queue: [] },
      { name: "other branch", ref: "feature", queue: [], exit: 1 },
      {
        name: "dispatch rejected",
        ref: "main",
        rejected: true,
        queue: [],
        exit: 8,
      },
      {
        name: "cron backstop",
        ref: "main",
        cron: true,
        queue: ["main", "development"],
      },
    ]) {
      const root = mkdtempSync(join(tmpdir(), "slop-scan-dispatch-"));
      try {
        writeFileSync(join(root, "gh"), fixture);
        chmodSync(join(root, "gh"), 0o755);
        const state = join(root, "state.json");
        writeFileSync(
          state,
          JSON.stringify({
            heads: {
              main: scenario.advanced ? "b".repeat(40) : sha,
              development: sha,
            },
            releases: { main: 17, development: 18 },
            deployed: scenario.skipped ? [] : [17, 18],
            active: scenario.active ? ["main"] : [],
            failDispatch: scenario.rejected ?? false,
            queued: [],
          }),
        );
        const result = spawnSync("bash", ["-c", dispatcher], {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            PATH: `${root}${delimiter}${process.env.PATH}`,
            DISPATCH_STATE: state,
            GITHUB_REPOSITORY: "example/slop",
            TRIGGER_EVENT: scenario.cron ? "schedule" : "workflow_run",
            RELEASE_REF: scenario.ref,
            RELEASE_SHA: sha,
            RELEASE_RUN_ID: scenario.ref === "development" ? "18" : "17",
          },
        });
        expect(result.status, `${scenario.name}: ${result.stderr}`).toBe(
          scenario.exit ?? 0,
        );
        expect(
          JSON.parse(readFileSync(state, "utf8")).queued,
          scenario.name,
        ).toEqual(scenario.queue);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  20_000,
);

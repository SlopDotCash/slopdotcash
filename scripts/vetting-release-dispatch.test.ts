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
const refuse = (key, message) => {
 if((state[key] ?? 0) <= 0) return false;
 state[key] -= 1;
 fs.writeFileSync(path, JSON.stringify(state));
 process.stdout.write(JSON.stringify(args.includes("--slurp") ? [{ message }] : { message }));
 console.error(message);
 process.exit(1);
};
if(args[0] === "api" && args[1] === "rate_limit") {
 process.stdout.write(String(Math.floor(Date.now() / 1000) - 10));
 process.exit(0);
}
if(args[0] === "api") {
 if(args[1].includes("commits/heads/")) refuse("serverErrors", "HTTP 502: Bad Gateway (https://api.github.com/" + args[1] + ")");
 if(args.includes("--slurp") && (args.includes("--jq") || args.includes("--template"))) {
  console.error("the --slurp option is not supported with --jq or --template");
  process.exit(1);
 }
 const route = args[1];
 const head = route.match(/commits\\/heads\\/(main|development)$/);
 const compare = route.match(/compare\\/([0-9a-f]{40})\\.\\.\\.([0-9a-f]{40})$/);
 if(head) process.stdout.write(state.heads[head[1]]);
 else if(compare) {
  refuse("compareRateLimited", "gh: API rate limit exceeded for installation. (HTTP 403)");
  const answer = { status: state.order, files: state.changed.map((filename) => ({ filename })) };
  // Apply the workflow's own --jq filter with the real jq, as gh does.
  const jq = require("node:child_process").spawnSync("jq", ["-r", args[args.indexOf("--jq") + 1]], { input: JSON.stringify(answer), encoding: "utf8" });
  if(jq.status !== 0) { console.error(jq.stderr); process.exit(1); }
  process.stdout.write(jq.stdout.trim());
 } else process.exit(7);
} else if(args[0] === "run" && args[1] === "list") {
 const ref = args[args.indexOf("--branch") + 1];
 process.stdout.write(state.active.includes(ref) ? "1" : "0");
} else if(args[0] === "workflow" && args[1] === "run") {
 refuse("rateLimited", "HTTP 403: API rate limit exceeded for installation.");
 if(state.failDispatch) process.exit(8);
 state.queued.push(args[args.indexOf("--ref") + 1]);
 fs.writeFileSync(path, JSON.stringify(state));
} else process.exit(9);
`;
const curlFixture = `#!${process.execPath}
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.DISPATCH_STATE, "utf8"));
const url = process.argv.slice(2).find((arg) => arg.startsWith("https://"));
const live = url.startsWith("https://staging.") ? state.live.development : state.live.main;
if(live === null) process.exit(22);
process.stdout.write(JSON.stringify({ commit: live }));
`;

test.skipIf(process.platform === "win32")(
  "a scan is dispatched when the served commit is the head or an earlier commit with the scanner unchanged",
  () => {
    for (const scenario of [
      { name: "production release", ref: "main", queue: ["main"] },
      { name: "staging release", ref: "development", queue: ["development"] },
      {
        name: "branch advanced without scanner changes",
        ref: "main",
        advanced: true,
        changed: ["src/Home.tsx", "workers/vetting/README.md"],
        queue: ["main"],
      },
      {
        name: "branch advanced with a scanner change",
        ref: "main",
        advanced: true,
        changed: ["src/Home.tsx", "workers/vetting/bounded-scan.ts"],
        queue: [],
      },
      {
        name: "dependency lock changed",
        ref: "main",
        advanced: true,
        changed: ["bun.lock"],
        queue: [],
      },
      {
        name: "commits not in order",
        ref: "main",
        advanced: true,
        order: "diverged",
        queue: [],
      },
      { name: "site unreadable", ref: "main", unreadable: true, queue: [] },
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
        name: "dispatch waits out a spent quota",
        ref: "main",
        rateLimited: 2,
        queue: ["main"],
      },
      {
        name: "quota still spent after the budget",
        ref: "main",
        rateLimited: 99,
        queue: [],
        exit: 1,
      },
      {
        name: "compare waits out a spent quota",
        ref: "main",
        advanced: true,
        compareRateLimited: 1,
        queue: ["main"],
      },
      {
        name: "server error retried",
        ref: "main",
        serverErrors: 1,
        queue: ["main"],
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
        writeFileSync(join(root, "curl"), curlFixture);
        chmodSync(join(root, "curl"), 0o755);
        const state = join(root, "state.json");
        writeFileSync(
          state,
          JSON.stringify({
            heads: {
              main: scenario.advanced ? "b".repeat(40) : sha,
              development: sha,
            },
            live: { main: scenario.unreadable ? null : sha, development: sha },
            changed: scenario.changed ?? [],
            order: scenario.order ?? "ahead",
            active: scenario.active ? ["main"] : [],
            failDispatch: scenario.rejected ?? false,
            rateLimited: scenario.rateLimited ?? 0,
            serverErrors: scenario.serverErrors ?? 0,
            compareRateLimited: scenario.compareRateLimited ?? 0,
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
            SCAN_DISPATCH_MIN_WAIT: "0",
            SCAN_DISPATCH_WAIT_BUDGET: "0",
            GITHUB_REPOSITORY: "example/slop",
            TRIGGER_EVENT: scenario.cron ? "schedule" : "workflow_run",
            RELEASE_REF: scenario.ref,
            COMPARE_TOKEN: "fixture",
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
  30_000,
);

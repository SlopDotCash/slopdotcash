import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

// These cases run real Git and runtime subprocesses. Windows process startup
// can exceed Bun's five-second unit-test default without a guard failure.
if (process.platform === "win32") setDefaultTimeout(60_000);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-staging-order-"));
  roots.push(root);
  const remote = join(root, "remote");
  const checkout = join(root, "checkout");
  mkdirSync(remote);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(remote, "init", "-b", "development");
  git(remote, "config", "user.name", "Staging test");
  git(remote, "config", "user.email", "staging@example.invalid");
  const revisions: string[] = [];
  for (let i = 0; i < 4; i++) {
    git(
      remote,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      `revision ${i}`,
    );
    revisions.push(git(remote, "rev-parse", "HEAD"));
  }
  git(remote, "checkout", "-b", "divergent", revisions[0]);
  git(
    remote,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "divergent",
  );
  const divergent = git(remote, "rev-parse", "HEAD");
  git(root, "clone", "--no-local", remote, checkout);
  git(checkout, "checkout", "--detach", revisions[1]);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const historyPath = join(root, "history.json");
  const callsPath = join(root, "calls");
  const stub = `const fs=require('node:fs');\nif(process.env.FAIL_HISTORY)process.exit(1);\nconst path=process.argv.at(-1);\nif(!/^repos\\/SlopDotCash\\/slopdotcash\\/deployments\\?environment=slop-staging&per_page=100&page=\\d+$/.test(path))process.exit(2);\nfs.appendFileSync(process.env.HISTORY_CALLS,path+'\\n');\nconst pages=JSON.parse(fs.readFileSync(process.env.HISTORY_PATH,'utf8'));\nprocess.stdout.write(JSON.stringify(pages[Number(path.split('page=').pop())-1]??[]));\n`;
  if (process.platform === "win32") {
    // execFileSync needs a native executable on Windows. The pinned test
    // runtime executes the local `api` script for `gh api <path>`.
    copyFileSync(process.execPath, join(bin, "gh.exe"));
    writeFileSync(join(checkout, "api"), stub);
  } else {
    writeFileSync(join(bin, "gh"), `#!${process.execPath}\n${stub}`);
    chmodSync(join(bin, "gh"), 0o755);
  }
  const deployment = (sha: string) => ({
    sha,
    environment: "slop-staging",
    ref: "development",
    production_environment: false,
  });
  const run = (pages: unknown[], extra: Record<string, string> = {}) => {
    writeFileSync(historyPath, JSON.stringify(pages));
    return spawnSync(
      process.execPath,
      [resolve("scripts/check-staging-order.mjs")],
      {
        cwd: checkout,
        encoding: "utf8",
        env: {
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          GIT_CONFIG_NOSYSTEM: "1",
          GITHUB_REPOSITORY: "SlopDotCash/slopdotcash",
          GITHUB_REF: "refs/heads/development",
          GITHUB_SHA: revisions[1],
          HISTORY_PATH: historyPath,
          HISTORY_CALLS: callsPath,
          ...extra,
        },
      },
    );
  };
  return {
    git,
    remote,
    checkout,
    revisions,
    divergent,
    deployment,
    run,
    callsPath,
  };
}

test("a verified ancestor can progress while development advances; old guard rejects it", () => {
  const f = fixture();
  const live = f
    .git(f.checkout, "ls-remote", "--refs", "origin", "refs/heads/development")
    .split(/\s/)[0];
  expect(live === f.revisions[1]).toBe(false);
  const result = f.run([
    [f.deployment(f.revisions[1]), f.deployment(f.revisions[0])],
  ]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Staging order verified");
});

test("a newer attempted deployment prevents rollback regardless of success", () => {
  const f = fixture();
  const result = f.run([[f.deployment(f.revisions[2])]]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Refusing staging rollback");
});

test("a divergent deployment prevents overwriting unknown staging state", () => {
  const f = fixture();
  expect(f.run([[f.deployment(f.divergent)]]).status).not.toBe(0);
});

test("a force-pushed development branch cannot authorize an abandoned candidate", () => {
  const f = fixture();
  f.git(f.remote, "branch", "-f", "development", f.divergent);
  expect(f.run([[]]).status).not.toBe(0);
});

test("history pagination cannot hide a newer attempt on the second page", () => {
  const f = fixture();
  const first = Array.from({ length: 100 }, () => f.deployment(f.revisions[0]));
  expect(f.run([first, [f.deployment(f.revisions[2])]]).status).not.toBe(0);
  expect(readFileSync(f.callsPath, "utf8").trim().split("\n")).toHaveLength(2);
});

test("unavailable, malformed or unknown deployment provenance fails closed", () => {
  const f = fixture();
  expect(f.run([[]], { FAIL_HISTORY: "1" }).status).not.toBe(0);
  expect(f.run([{}]).status).not.toBe(0);
  expect(f.run([[]]).status).not.toBe(0);
  expect(
    f.run([[{ ...f.deployment(f.revisions[0]), sha: "unknown" }]]).status,
  ).not.toBe(0);
  expect(
    f.run([[{ ...f.deployment(f.revisions[0]), environment: "production" }]])
      .status,
  ).not.toBe(0);
});

test("history beyond the bound fails rather than trusting an incomplete scan", () => {
  const f = fixture();
  const page = Array.from({ length: 100 }, () => f.deployment(f.revisions[0]));
  const result = f.run(Array.from({ length: 10 }, () => page));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("history exceeds its bound");
});

test("wrong checkout, repository or branch cannot reach the staging gate", () => {
  const f = fixture();
  expect(f.run([[]], { GITHUB_SHA: f.revisions[2] }).status).not.toBe(0);
  expect(f.run([[]], { GITHUB_REPOSITORY: "someone/fork" }).status).not.toBe(0);
  expect(f.run([[]], { GITHUB_REF: "refs/heads/main" }).status).not.toBe(0);
});

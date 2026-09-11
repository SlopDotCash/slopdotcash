import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("refreshes the published approved ancestor, renews its artifact, and rejects superseded publication", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-release-selection-"));
  try {
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "approved",
    );
    const sha = git("rev-parse", "HEAD");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "awaiting approval",
    );
    const newer = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/develop", newer);
    const fixture = join(root, "fetch.mjs");
    writeFileSync(
      fixture,
      `globalThis.fetch = async () => new Response(JSON.stringify({repository:"SlopDotCash/slopdotcash", revisionStatus:"committed", revision:${JSON.stringify(sha)}}));`,
    );
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env node
const endpoint = process.argv.at(-1);
const run = { id: 90, workflow_id: 7, head_sha: ${JSON.stringify(sha)}, head_branch: "develop", event: "push", conclusion: "success", head_repository: { full_name: "SlopDotCash/slopdotcash" } };
const result = endpoint.includes("/workflows/") ? { workflow_runs: process.env.NO_APPROVAL ? [] : [run] } : endpoint.includes("/artifacts?") ? { artifacts: [{ name: "slop-source-${sha}", expired: false, workflow_run: {id: 91, head_branch: "develop"} }] } : {...run, id:91, head_sha:${JSON.stringify(newer)}, event:"schedule"};
process.stdout.write(JSON.stringify(result));
`,
      { mode: 0o755 },
    );
    const output = join(root, "outputs");
    const env = { PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output };
    const run = (args = [], extra = {}) =>
      spawnSync(
        "node",
        ["--import", fixture, resolve("scripts/released-source.mjs"), ...args],
        { cwd: root, env: { ...env, ...extra }, encoding: "utf8" },
      );
    const selected = run();
    expect(selected.status, selected.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(
      `sha=${sha}\nbaseline=91\nbaseline_name=slop-source-${sha}\n`,
    );
    expect(run(["--check"], { RELEASE_SHA: sha }).status).toBe(0);
    const stale = run(["--check"], { RELEASE_SHA: newer });
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("Production changed");
    const unapproved = run([], { NO_APPROVAL: "1" });
    expect(unapproved.status).not.toBe(0);
    expect(unapproved.stderr).toContain("no successful approved release");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

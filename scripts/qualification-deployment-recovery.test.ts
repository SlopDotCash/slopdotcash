import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
async function qualify(kind: string) {
  const directory = await mkdtemp(join(tmpdir(), "qualification-deploy-test-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        join(root, "tests/fixtures/qualification-deployment.mjs"),
        process.env.QUALIFICATION_SCRIPT_UNDER_TEST ??
          join(root, "scripts/qualify-vetting-controls.ts"),
        "--flags",
        "--execute",
      ],
      {
        cwd: root,
        env: {
          HOME: process.env.HOME,
          TMPDIR: tmpdir(),
          PATH: process.env.PATH,
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_REF: "refs/heads/development",
          GITHUB_REPOSITORY: "SlopDotCash/slopdotcash",
          GITHUB_WORKFLOW_REF:
            "SlopDotCash/slopdotcash/.github/workflows/vetting-recovery-qualification.yml@refs/heads/development",
          GITHUB_SHA: sha,
          GITHUB_RUN_ID: "12345",
          GITHUB_RUN_ATTEMPT: "1",
          RUNNER_TEMP: directory,
          VETTING_QUALIFICATION_MODE: "execute",
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
          CLOUDFLARE_API_TOKEN: "qualification-fixture-token",
          QUALIFICATION_FIXTURE_CASE: kind,
          QUALIFICATION_FIXTURE_STATE: join(directory, "state.json"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const text = await readFile(
      join(directory, "vetting-flags-report/result.json"),
      "utf8",
    );
    expect(code).toBe(1);
    expect(text + stdout + stderr).not.toContain(
      "PRIVATE_PROCESS_OUTPUT_CANARY",
    );
    return {
      report: JSON.parse(text),
      state: JSON.parse(await readFile(join(directory, "state.json"), "utf8")),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a failed CLI after upload cleans the owned Worker and bound queue without claiming acceptance", async () => {
  const { report, state } = await qualify("owned");
  expect(state.worker).toBe(false);
  expect(report.failure).toEqual({
    stage: "deploy-worker",
    kind: "Error",
    exitStatus: 1,
    signal: null,
    cloudflareCodes: [10021],
  });
  expect(report.success).toBe(false);
  expect(report.workerRecovery).toBe("verified-owned-deployment");
  expect(report.cleanup).toEqual({
    complete: true,
    failedOperations: 0,
    unresolvedCreations: [],
  });
  expect(state.queues).toEqual([]);
  expect(state.databases).toEqual([]);
  expect(state.buckets).toEqual([]);
});

test("an uploaded Worker with a different source remains unresolved and is never deleted", async () => {
  const { report, state } = await qualify("foreign-source");
  expect(report.success).toBe(false);
  expect(report.workerRecovery).toBe("unresolved");
  expect(report.cleanup.complete).toBe(false);
  expect(report.cleanup.unresolvedCreations).toContain(
    "slop-vet-flags-12345-1",
  );
  expect(state.worker).toBe(true);
  expect(state.actions).not.toContain("delete-worker");
  expect(state.queues).toHaveLength(1);
});

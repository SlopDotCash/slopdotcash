import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { copyFixtureSkills } from "../tests/fixture-overlay.mjs";

type SessionReport = { sessions: Record<string, Record<string, unknown>> };
type RunReceiptUsage = {
  normalizeSessionReport(
    payload: unknown,
    repositoryRoot: string,
  ): SessionReport;
  usageDelta(
    before: SessionReport | null,
    after: SessionReport | null,
    client: string,
  ): Record<string, unknown>;
};

// A rendered skill copy: the shared script reads the project.json beside it.
// It has no declaration file; type only what this test uses.
const skills = mkdtempSync(join(tmpdir(), "run-receipt-skills-"));
copyFixtureSkills(skills);
const { normalizeSessionReport, usageDelta }: RunReceiptUsage = await import(
  pathToFileURL(join(skills, "contribute-to-eliza/scripts/run-receipt.mjs"))
    .href
);

// A native absolute root: the dashed Claude Code directory name that scopes a
// session is derived from the same platform path the script normalizes.
const repositoryRoot = mkdtempSync(join(tmpdir(), "run-receipt-usage-"));

afterAll(() => {
  rmSync(repositoryRoot, { recursive: true, force: true });
  rmSync(skills, { recursive: true, force: true });
});

/** The dashed directory name Claude Code derives from a repository root. */
function claudeProjectDirectoryName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]/gu, "-");
}

// Session row shape from `ccusage@20.0.20 codex session --json --mode calculate`.
// Codex rows have no project path. "directory" is the date directory of the
// session file under $CODEX_HOME/sessions, not the working directory.
function codexReport(
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  costUSD: number,
) {
  return {
    sessions: [
      {
        cacheCreationTokens: 0,
        cacheReadTokens,
        costUSD,
        directory: "2026/10/18",
        inputTokens,
        lastActivity: "2026-10-18T10:00:05.000Z",
        outputTokens,
        reasoningOutputTokens: 0,
        sessionFile: "rollout-2026-10-18T10-00-00-abc",
        sessionId: "2026/10/18/rollout-2026-10-18T10-00-00-abc",
        totalTokens: inputTokens + cacheReadTokens + outputTokens,
      },
    ],
  };
}

test("a Codex session is kept although ccusage reports only its date directory", () => {
  const report = normalizeSessionReport(
    codexReport(600, 400, 200, 0.0028),
    repositoryRoot,
  );
  const sessions = Object.values(report.sessions);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ pathMatched: false, totalTokens: 1200 });
});

test("a measured Codex run reports bounded usage instead of no usage", () => {
  const before = normalizeSessionReport(
    codexReport(600, 400, 200, 0.0028),
    repositoryRoot,
  );
  const after = normalizeSessionReport(
    codexReport(900, 1400, 500, 0.0061),
    repositoryRoot,
  );
  expect(usageDelta(before, after, "codex")).toEqual({
    source: "ccusage-session-v20",
    confidence: "bounded",
    inputTokens: 300,
    outputTokens: 300,
    cacheCreationTokens: 0,
    cacheReadTokens: 1000,
    totalTokens: 1600,
    costMicroUsd: "3300",
    sessionCount: 1,
  });
});

test("Claude Code and Grok Build project paths still decide the session scope", () => {
  const report = normalizeSessionReport(
    {
      sessions: [
        {
          sessionId: "claude-here",
          projectPath: claudeProjectDirectoryName(repositoryRoot),
          inputTokens: 10,
          outputTokens: 5,
        },
        {
          sessionId: "grok-elsewhere",
          projectPath: join(tmpdir(), "other-checkout"),
          inputTokens: 10,
          outputTokens: 5,
        },
      ],
    },
    repositoryRoot,
  );
  expect(Object.values(report.sessions)).toEqual([
    expect.objectContaining({ pathMatched: true, totalTokens: 15 }),
  ]);
});

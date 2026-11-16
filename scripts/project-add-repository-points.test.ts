// Points penalties on an appended repository follow its start month, like
// its awards (PRD section 4). The frozen fixture registry has no appended
// repository, so a probe process loads one with the registry module mocked.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const probe = (registry: string, points: string, fixture: string) => `
import { expect, mock, test } from "bun:test";
import { RAW_PROJECT_DEFINITIONS } from ${JSON.stringify(fixture)};
const EXTRA = "acme-tools/extra";
mock.module(${JSON.stringify(registry)}, () => ({
  RAW_PROJECT_DEFINITIONS: RAW_PROJECT_DEFINITIONS.map((project) =>
    project.id !== "asi"
      ? project
      : {
          ...project,
          repositories: [
            ...project.repositories,
            {
              id: EXTRA,
              displayName: EXTRA,
              githubUrl: "https://github.com/" + EXTRA,
              description: "Extra tooling used by the research framework.",
              integrationBranch: "main",
              githubId: "555000111",
              nodeId: "R_extra",
              countsFrom: "2026-12-01T00:00:00.000Z",
            },
          ],
        },
  ),
}));
test("probe", async () => {
  const points = await import(${JSON.stringify(points)});
  const actor = { kind: "User", id: "MDQ6VXNlcjQy", login: "author" };
  const november = "2026-11-10T00:00:00.000Z";
  const credit = {
    key: points.pointKey("asi", actor.id, "merged-pull-request", "PR_credit"),
    actor: { id: actor.id, login: actor.login },
    projectId: "asi",
    category: "merged-pull-request",
    amount: 30,
    occurredAt: november,
    sourceId: "PR_credit",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/1",
    workUnitId: "PR_credit",
    provisional: false,
  };
  const journal = points.appendPointAwards(
    points.emptyPointsJournal(november),
    [credit],
    "a".repeat(64),
    "slop-score-v2",
    november,
  );
  const penalty = (repository, sourceId, occurredAt = november) => ({
    id: sourceId + ":penalty",
    actor,
    repository,
    occurredAt,
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 1,
    source: {
      id: sourceId,
      kind: "pull-request",
      number: 2,
      title: "x",
      url: "https://github.com/" + repository + "/pull/2",
    },
  });
  const reconcile = (penalties) =>
    points.reconcilePointPenalties(journal, "b".repeat(64), november, {
      penalties,
    });
  // Before its start month the appended repository debits nothing.
  expect(reconcile([penalty(EXTRA, "PR_extra_november")])).toBe(journal);
  // The first repository's debit in the same month is unchanged.
  const debited = reconcile([penalty("elizaOS/asi", "PR_first_november")]);
  expect(debited.revisions.length).toBe(journal.revisions.length + 1);
  expect(debited.revisions.at(-1).award.amount).toBeLessThan(0);
});
`;

test("a penalty on an appended repository before its start month debits no Points", () => {
  const directory = mkdtempSync(join(root, ".points-probe-"));
  try {
    const file = join(directory, "probe.test.ts");
    writeFileSync(
      file,
      probe(
        join(root, "src/lib/project-registry.generated.mjs"),
        join(root, "src/lib/points.ts"),
        join(root, "tests/fixtures/project-registry.mjs"),
      ),
    );
    const result = spawnSync(process.execPath, ["test", file], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 70_000);

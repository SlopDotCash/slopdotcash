import { afterEach, expect, setSystemTime, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  awardForScore,
  latestPoints,
  type PointsJournal,
} from "../src/lib/points";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const REFRESHED_AT = "2026-11-20T01:00:00.000Z";

function input(carrierCommit = false, at = GENERATED_AT) {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const value = penaltyScoreInput([], at);
  const pull = value.mergedPullRequestOutcomes.find(
    (row) => row.id === "PR_november",
  );
  assert(pull);
  pull.author = PROJECT_OWNER;
  pull.commits = [
    { oid: "a".repeat(40), author: PENALIZED_AUTHOR, parentCount: 1 },
    ...(carrierCommit
      ? [{ oid: "b".repeat(40), author: PROJECT_OWNER, parentCount: 1 }]
      : []),
  ];
  value.mergedPullRequestOutcomes = [pull];
  value.mergedPullRequests = [];
  value.detailEligibleMergedPullRequestIds = [];
  value.closedUnmergedPullRequests = [];
  value.source.counts.mergedPullRequests = 1;
  value.source.counts.detailedMergedPullRequests = 0;
  return value;
}

function setup() {
  const oldSnapshot = createLeaderboardSnapshot(input(true));
  // Earlier published snapshots did not carry independent implementation proof.
  for (const row of oldSnapshot.valueAssessmentCoverage ?? [])
    delete row.verifiedImplementationActorNodeIds;
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const journal = applyPointsSnapshot(
    empty,
    oldSnapshot,
    hash(oldSnapshot),
    GENERATED_AT,
  );
  const current = createLeaderboardSnapshot(input(false, REFRESHED_AT));
  return { empty, oldSnapshot, journal, current };
}

function amounts(journal: PointsJournal) {
  return new Map(
    [...latestPoints(journal).values()].map(({ award }) => [
      award.actor.id,
      award.amount,
    ]),
  );
}

test("a complete primary-commit census removes only the old provisional carrier share, once", () => {
  const { journal, current } = setup();
  expect(current.valueAssessmentCoverage?.[0]).toMatchObject({
    status: "missing",
    verifiedImplementationActorNodeIds: [PENALIZED_AUTHOR.id],
  });
  assertLeaderboardSnapshot(current);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(corrected.revisions.slice(0, journal.revisions.length)).toEqual(
    journal.revisions,
  );
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(10);
  expect(corrected.revisions.at(-1)?.decision?.reason).toContain(
    "primary-commit",
  );
  const replay = applyPointsSnapshot(
    corrected,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(replay.revisions).toEqual(corrected.revisions);
});

for (const uncertainty of [
  "missing-proof",
  "unknown-author",
  "merge-commit",
  "unknown-parents",
  "other-branch",
] as const) {
  test(`${uncertainty} retains the previously recorded share`, () => {
    const { journal } = setup();
    const next = input(false, REFRESHED_AT);
    const pull = next.mergedPullRequestOutcomes[0];
    const commit = pull.commits?.[0];
    assert(commit);
    if (uncertainty === "unknown-author") commit.author = null;
    if (uncertainty === "merge-commit") commit.parentCount = 2;
    if (uncertainty === "unknown-parents") delete commit.parentCount;
    if (uncertainty === "other-branch") pull.baseRefName = "release";
    const current = createLeaderboardSnapshot(next);
    const coverage = current.valueAssessmentCoverage?.[0];
    assert(coverage);
    if (uncertainty === "missing-proof")
      delete coverage.verifiedImplementationActorNodeIds;
    expect(coverage.verifiedImplementationActorNodeIds).toBeUndefined();
    const corrected = applyPointsSnapshot(
      journal,
      current,
      hash(current),
      REFRESHED_AT,
    );
    expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(10);
  });
}

for (const binding of ["assessed", "final"] as const) {
  test(`an earlier ${binding} award survives missing valuation even when attribution changes`, () => {
    const { empty, oldSnapshot, current } = setup();
    const awards = oldSnapshot.ledger.map(awardForScore);
    const carrier = awards.find((award) => award.actor.id === PROJECT_OWNER.id);
    assert(carrier);
    carrier.amount = 90;
    if (binding === "final") carrier.provisional = false;
    const journal = appendPointAwards(
      empty,
      awards,
      hash(oldSnapshot),
      oldSnapshot.ruleVersion,
      GENERATED_AT,
      binding === "assessed"
        ? new Map([
            [
              carrier.key,
              {
                sourceId: `value:${"c".repeat(64)}`,
                effectiveAt: GENERATED_AT,
                reason: "Earlier source-bound assessment",
              },
            ],
          ])
        : undefined,
    );
    const corrected = applyPointsSnapshot(
      journal,
      current,
      hash(current),
      REFRESHED_AT,
    );
    expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(90);
  });
}

test("malformed or source-inconsistent implementation proof cannot validate", () => {
  const { current } = setup();
  for (const ids of [
    [],
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR.id],
    [PROJECT_OWNER.id],
    ["not-a-github-user"],
  ]) {
    const changed = structuredClone(current);
    const coverage = changed.valueAssessmentCoverage?.[0];
    assert(coverage);
    coverage.verifiedImplementationActorNodeIds = ids;
    expect(() => assertLeaderboardSnapshot(changed)).toThrow(
      "Verified implementation attribution is invalid",
    );
  }
});

test("recipient correction retains the original contributor's prior assessed amount", () => {
  const { empty, oldSnapshot, current } = setup();
  const awards = oldSnapshot.ledger.map(awardForScore);
  const original = awards.find(
    (award) => award.actor.id === PENALIZED_AUTHOR.id,
  );
  assert(original);
  original.amount = 90;
  const journal = appendPointAwards(
    empty,
    awards,
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
    new Map([
      [
        original.key,
        {
          sourceId: `value:${"d".repeat(64)}`,
          effectiveAt: GENERATED_AT,
          reason: "Existing accepted value",
        },
      ],
    ]),
  );
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(90);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
});

test("a known branch-sync merge grants no share beside verified implementation", () => {
  const { journal } = setup();
  const next = input(false, REFRESHED_AT);
  const commits = next.mergedPullRequestOutcomes[0].commits;
  assert(commits);
  commits.push({ oid: "c".repeat(40), author: PROJECT_OWNER, parentCount: 2 });
  const current = createLeaderboardSnapshot(next);
  expect(
    current.valueAssessmentCoverage?.[0].verifiedImplementationActorNodeIds,
  ).toEqual([PENALIZED_AUTHOR.id]);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(10);
});

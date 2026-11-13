import { afterEach, expect, setSystemTime, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGlobalLeaders } from "../src/lib/global-leaderboard";
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
  pointKey,
} from "../src/lib/points";
import { createPaymentProjectView } from "../src/lib/project-view";
import { allocateReviewBudgetMinor } from "../src/lib/reward-cycle";
import { penaltyDeductions } from "../src/lib/score-penalties";
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
    {
      oid: "a".repeat(40),
      author: PENALIZED_AUTHOR,
      parentCount: 1,
      additions: 3,
      deletions: 1,
    },
    ...(carrierCommit
      ? [
          {
            oid: "b".repeat(40),
            author: PROJECT_OWNER,
            parentCount: 1,
            additions: 1,
            deletions: 1,
          },
        ]
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

function legacyAwards(snapshot: ReturnType<typeof createLeaderboardSnapshot>) {
  const original = snapshot.ledger.find(
    (event) => event.actor.id === PENALIZED_AUTHOR.id,
  );
  assert(original);
  const award = { ...awardForScore(original), amount: 10 };
  return [
    award,
    {
      ...award,
      key: pointKey(
        award.projectId,
        PROJECT_OWNER.id,
        award.category,
        award.sourceId,
      ),
      actor: { id: PROJECT_OWNER.id, login: PROJECT_OWNER.login },
    },
  ];
}

function setup() {
  const oldSnapshot = createLeaderboardSnapshot(input(true));
  // Earlier published snapshots did not carry independent implementation proof.
  for (const row of oldSnapshot.valueAssessmentCoverage ?? []) {
    delete row.verifiedImplementationActorNodeIds;
    delete row.implementationAllocation;
  }
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const journal = appendPointAwards(
    empty,
    legacyAwards(oldSnapshot),
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
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

test("a complete changed-line census transfers the carrier share without changing the PR total", () => {
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
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(20);
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
  "missing-weights",
  "merge-commit",
  "unknown-parents",
] as const) {
  test(`${uncertainty} retains the previously recorded share`, () => {
    const { journal } = setup();
    const next = input(false, REFRESHED_AT);
    const pull = next.mergedPullRequestOutcomes[0];
    const commit = pull.commits?.[0];
    assert(commit);
    if (uncertainty === "merge-commit") commit.parentCount = 2;
    if (uncertainty === "unknown-parents") delete commit.parentCount;
    const current = createLeaderboardSnapshot(next);
    const coverage = current.valueAssessmentCoverage?.[0];
    assert(coverage);
    if (uncertainty === "missing-proof") {
      delete coverage.verifiedImplementationActorNodeIds;
      delete coverage.implementationAllocation;
    }
    if (uncertainty === "missing-weights")
      delete coverage.implementationAllocation;
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
  test(`an earlier ${binding} value survives allocation-only correction`, () => {
    const { empty, oldSnapshot, current } = setup();
    const awards = legacyAwards(oldSnapshot);
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
    expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
    expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(100);
    if (binding === "assessed") {
      const recipient = [...latestPoints(corrected).values()].find(
        (revision) => revision.award.actor.id === PENALIZED_AUTHOR.id,
      );
      expect(recipient?.decision?.sourceId).toBe(`value:${"c".repeat(64)}`);
      expect(recipient?.decision?.reason).toContain("allocation-only");
    }
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

test("allocation proof rejects zero pools and hidden vendor or conflicting recipients", () => {
  for (const defect of ["zero-pool", "vendor", "conflicting-login"] as const) {
    const { current } = setup();
    const row = current.valueAssessmentCoverage?.[0];
    assert(row?.implementationAllocation);
    delete row.verifiedImplementationActorNodeIds;
    if (defect === "zero-pool")
      row.implementationAllocation.totalScoreThirds = 0;
    else
      row.implementationAllocation.weights.push({
        actorNodeId: defect === "vendor" ? "U_kgDOD-0LXg" : PROJECT_OWNER.id,
        actorLogin: defect === "vendor" ? "codex" : PENALIZED_AUTHOR.login,
        changedLines: "0",
      });
    expect(() => assertLeaderboardSnapshot(current)).toThrow();
  }
});

test("recipient correction retains the whole prior assessed PR amount", () => {
  const { empty, oldSnapshot, current } = setup();
  const awards = legacyAwards(oldSnapshot);
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
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(100);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
});

test("a known branch-sync merge grants no share beside verified implementation", () => {
  const { journal } = setup();
  const next = input(false, REFRESHED_AT);
  const commits = next.mergedPullRequestOutcomes[0].commits;
  assert(commits);
  commits.push({
    oid: "c".repeat(40),
    author: PROJECT_OWNER,
    parentCount: 2,
    additions: 1000,
    deletions: 1000,
  });
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
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(20);
});

test("changed lines rebalance existing equal shares without a new value assessment", () => {
  const { empty, oldSnapshot } = setup();
  const prior = legacyAwards(oldSnapshot).map((award) => ({
    ...award,
    amount: 60,
  }));
  const journal = appendPointAwards(
    empty,
    prior,
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const next = input(true, REFRESHED_AT);
  const commits = next.mergedPullRequestOutcomes[0].commits;
  assert(commits?.[1]);
  commits[0].additions = 1;
  commits[0].deletions = 0;
  commits[1].additions = 2;
  commits[1].deletions = 1;
  const current = createLeaderboardSnapshot(next);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(30);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(90);
  expect(
    [...amounts(corrected).values()].reduce((sum, value) => sum + value, 0),
  ).toBe(120);
});

test("legacy-policy recipient corrections preserve the complete recorded PR total", () => {
  const { empty, oldSnapshot } = setup();
  const occurredAt = "2026-10-29T12:00:00.000Z";
  const journal = appendPointAwards(
    empty,
    legacyAwards(oldSnapshot).map((award) => ({
      ...award,
      amount: 60,
      occurredAt,
    })),
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const next = input(true, REFRESHED_AT);
  next.mergedPullRequestOutcomes[0].mergedAt = occurredAt;
  const commits = next.mergedPullRequestOutcomes[0].commits;
  assert(commits?.[1]);
  commits[0].additions = 1;
  commits[0].deletions = 0;
  commits[1].additions = 3;
  commits[1].deletions = 0;
  const current = createLeaderboardSnapshot(next);
  expect(current.valueAssessmentCoverage?.[0].status).toBe("legacy-policy");
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(30);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(90);
});

test("legacy-policy missing weights retain both prior awards across replay", () => {
  const { empty, oldSnapshot } = setup();
  const occurredAt = "2026-10-29T12:00:00.000Z";
  const journal = appendPointAwards(
    empty,
    legacyAwards(oldSnapshot).map((award) => ({
      ...award,
      amount: 60,
      occurredAt,
    })),
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const next = input(true, REFRESHED_AT);
  next.mergedPullRequestOutcomes[0].mergedAt = occurredAt;
  const current = createLeaderboardSnapshot(next);
  const coverage = current.valueAssessmentCoverage?.[0];
  assert(coverage?.status === "legacy-policy");
  delete coverage.implementationAllocation;
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(corrected.revisions).toEqual(journal.revisions);
  expect(
    applyPointsSnapshot(corrected, current, hash(current), REFRESHED_AT)
      .revisions,
  ).toEqual(journal.revisions);
});

test("an actor rounded out of the minimum pool can receive a retained larger pool share", () => {
  const { empty, oldSnapshot } = setup();
  const prior = legacyAwards(oldSnapshot).filter(
    (award) => award.actor.id === PENALIZED_AUTHOR.id,
  );
  prior[0].amount = 100;
  const journal = appendPointAwards(
    empty,
    prior,
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const next = input(true, REFRESHED_AT);
  const commits = next.mergedPullRequestOutcomes[0].commits;
  assert(commits?.[1]);
  commits[0].additions = 99;
  commits[0].deletions = 0;
  commits[1].additions = 1;
  commits[1].deletions = 0;
  const current = createLeaderboardSnapshot(next);
  expect(
    current.ledger.some((event) => event.actor.id === PROJECT_OWNER.id),
  ).toBe(false);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(99);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(1);
});

for (const amount of [0, 11]) {
  test(`the prior ${amount}-point source is not replaced by the minimum`, () => {
    const { empty, oldSnapshot, current } = setup();
    const prior = legacyAwards(oldSnapshot).map((award) => ({
      ...award,
      amount,
    }));
    const journal = appendPointAwards(
      empty,
      prior,
      hash(oldSnapshot),
      oldSnapshot.ruleVersion,
      GENERATED_AT,
    );
    const corrected = applyPointsSnapshot(
      journal,
      current,
      hash(current),
      REFRESHED_AT,
    );
    expect(
      [...amounts(corrected).values()].reduce((sum, value) => sum + value, 0),
    ).toBe(amount * 2);
    expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(amount * 2);
  });
}

test("complete zero-line evidence conserves the pool with equal sharing", () => {
  const { empty, oldSnapshot } = setup();
  const prior = legacyAwards(oldSnapshot).map((award, index) => ({
    ...award,
    amount: index === 0 ? 90 : 30,
  }));
  const journal = appendPointAwards(
    empty,
    prior,
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const next = input(true, REFRESHED_AT);
  for (const commit of next.mergedPullRequestOutcomes[0].commits ?? []) {
    commit.additions = 0;
    commit.deletions = 0;
  }
  const current = createLeaderboardSnapshot(next);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(60);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(60);
});

test("complete allocation proof does not require the old positive-recipient list", () => {
  const { journal, current } = setup();
  const coverage = current.valueAssessmentCoverage?.[0];
  assert(coverage?.implementationAllocation);
  delete coverage.verifiedImplementationActorNodeIds;
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(20);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
});

test("an unlinked primary author uses the source creator's line weight", () => {
  const { journal } = setup();
  const next = input(false, REFRESHED_AT);
  const commit = next.mergedPullRequestOutcomes[0].commits?.[0];
  assert(commit);
  commit.author = null;
  const current = createLeaderboardSnapshot(next);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(20);
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(0);
});

test("retained-copy evidence gives an unlinked commit's weight to its original creator", () => {
  const { journal } = setup();
  const next = input(false, REFRESHED_AT);
  const pull = next.mergedPullRequestOutcomes[0];
  const commit = pull.commits?.[0];
  assert(commit);
  commit.author = null;
  next.retainedCommitAuthors = new Map([
    [
      pull.id,
      new Map([
        [
          commit.oid,
          {
            actor: PENALIZED_AUTHOR,
            originalPullRequestId: "PR_original",
            originalPullRequestUrl: pull.url.replace(/\/[0-9]+$/u, "/7"),
            originalCommitSha: commit.oid,
          },
        ],
      ]),
    ],
  ]);
  const current = createLeaderboardSnapshot(next);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(20);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
});

test("a prior joint work-unit allocation is held until its full unit is reassessed", () => {
  const { empty, oldSnapshot, current } = setup();
  const workUnitId = `wu_${"e".repeat(64)}`;
  const prior = legacyAwards(oldSnapshot).map((award) => ({
    ...award,
    workUnitId,
    key: pointKey(
      award.projectId,
      award.actor.id,
      award.category,
      award.sourceId,
      workUnitId,
    ),
  }));
  const journal = appendPointAwards(
    empty,
    prior,
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(corrected.revisions).toEqual(journal.revisions);
});

test("complete commit weights rebalance an accepted PR on any branch", () => {
  const { journal } = setup();
  const next = input(false, REFRESHED_AT);
  next.mergedPullRequestOutcomes[0].baseRefName = "release";
  const current = createLeaderboardSnapshot(next);
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(20);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(0);
});

test("17 versus 19 changed lines share ten Points through rewards and penalty caps", () => {
  const { empty, oldSnapshot } = setup();
  const next = input(true, REFRESHED_AT);
  const commits = next.mergedPullRequestOutcomes[0].commits;
  assert(commits?.[1]);
  commits[0].additions = 17;
  commits[0].deletions = 0;
  commits[1].additions = 19;
  commits[1].deletions = 0;
  const current = createLeaderboardSnapshot(next);
  const prior = legacyAwards(oldSnapshot).filter(
    (award) => award.actor.id === PENALIZED_AUTHOR.id,
  );
  const journal = appendPointAwards(
    empty,
    prior,
    hash(oldSnapshot),
    oldSnapshot.ruleVersion,
    GENERATED_AT,
  );
  const corrected = applyPointsSnapshot(
    journal,
    current,
    hash(current),
    REFRESHED_AT,
  );
  expect(amounts(corrected).get(PENALIZED_AUTHOR.id)).toBe(5);
  expect(amounts(corrected).get(PROJECT_OWNER.id)).toBe(5);
  const view = createPaymentProjectView(current, "asi", "2026-11");
  expect(view.leaders.map((leader) => leader.adjustedWeight)).toEqual([
    5000, 5000,
  ]);
  expect(
    createGlobalLeaders(current, [], {
      schemaVersion: "1",
      generatedAt: REFRESHED_AT,
      cycles: [],
    }).map((leader) => leader.score),
  ).toEqual([5 / 30, 5 / 30]);
  const recipients = view.leaders.map((leader) => ({
    actorId: leader.actor.id,
    scoreThirds: leader.scoreThirds,
  }));
  expect(
    [...allocateReviewBudgetMinor(101n, recipients).values()].reduce(
      (sum, amount) => sum + amount,
      0n,
    ),
  ).toBe(101n);
  const event = current.ledger.find(
    (row) => row.actor.id === PENALIZED_AUTHOR.id,
  );
  assert(event);
  const deductions = penaltyDeductions(
    current.ledger,
    [
      {
        id: "PR_precision_penalty:penalty",
        actor: event.actor,
        repository: event.repository,
        occurredAt: event.occurredAt,
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 1,
        source: { ...event.source, kind: "pull-request" },
      },
    ],
    () => "asi",
  );
  expect(deductions.byActor.get(PENALIZED_AUTHOR.id)).toBe(0.5);
});

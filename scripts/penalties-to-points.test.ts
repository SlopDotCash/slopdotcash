import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  assertPointsJournal,
  emptyPointsJournal,
  PENALTY_DEBIT_CATEGORY,
  type PointAward,
  pointMembers,
} from "../src/lib/points";
import { REGISTERED_REPOSITORIES } from "../src/lib/repositories.mjs";
import {
  CLOSED_PULL_REQUEST_ID,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

/** A registered project repository, provided by tests/registry-preload.ts. */
const repository = REGISTERED_REPOSITORIES[0];
const actor = {
  id: "U_kgDOAbcdef",
  login: "penalised-author",
  kind: "User" as const,
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  url: "https://github.com/penalised-author",
};
const merged = {
  id: "PR_merged:merged",
  actor,
  category: "merged-pull-request" as const,
  points: 90,
  scoreThirds: 9,
  workUnitId: "wu_test_merged_1",
  occurredAt: "2026-10-15T00:00:00.000Z",
  repository: repository.id,
  source: {
    id: "PR_merged",
    kind: "pull-request" as const,
    number: 1,
    title: "A merged change",
    url: "https://github.com/owner/repo/pull/1",
  },
};
const spam = {
  id: "PR_spam",
  actor,
  repository: repository.id,
  occurredAt: "2026-10-16T00:00:00.000Z",
  category: "spam",
  tableVersion: "slopbot-penalties-v1",
  debitThirds: 3,
  source: {
    id: "PR_spam",
    kind: "pull-request" as const,
    number: 2,
    title: "Spam",
    url: "https://github.com/owner/repo/pull/2",
  },
};

function snapshot(
  overrides: Partial<{ penalties: unknown[]; ledger: unknown[] }> = {},
): LeaderboardSnapshot {
  return {
    generatedAt: "2026-10-20T00:00:00.000Z",
    ruleVersion: "slop-score-v2",
    window: {
      from: "2026-09-15T00:00:00.000Z",
      to: "2026-10-20T00:00:00.000Z",
    },
    repositories: [{ id: repository.id }],
    ledger: overrides.ledger ?? [merged],
    leaders: [
      {
        actor,
        score: 2,
        scoreThirds: 6,
      },
    ],
    penalties: overrides.penalties ?? [spam],
    reviewExclusions: [],
  } as unknown as LeaderboardSnapshot;
}

function totalAfter(snapshots: LeaderboardSnapshot[]): number {
  let journal = emptyPointsJournal("2026-10-20T00:00:00.000Z");
  for (const [index, snap] of snapshots.entries())
    journal = applyPointsSnapshot(
      journal,
      snap,
      "a".repeat(63) + String(index),
      snap.generatedAt,
    );
  assertPointsJournal(journal);
  const member = pointMembers(journal, "2026-10").find(
    (m) => m.actor.id === actor.id,
  );
  return member?.total ?? 0;
}

describe("published Slopbot debits reach Points", () => {
  test("a spam debit lowers the same UTC month's points", () => {
    // The merged change alone is 9 thirds = 90 Points; the 3-third spam debit
    // is 30 Points, so the one public measure must report 60, not 90.
    expect(totalAfter([snapshot()])).toBe(60);
    expect(totalAfter([snapshot({ penalties: [] })])).toBe(90);
  });

  test("a debit never takes the month below zero", () => {
    // 24 thirds of debit against a 9-third month applies only the credit.
    const scam = { ...spam, id: "PR_scam", debitThirds: 24 };
    expect(totalAfter([snapshot({ penalties: [scam] })])).toBe(0);
  });

  test("a reversed debit restores the month", () => {
    const debited = snapshot();
    const reversed = snapshot({ penalties: [] });
    expect(totalAfter([debited, reversed])).toBe(90);
  });

  test("a debit keeps its recorded close month and adds no contribution", () => {
    let journal = applyPointsSnapshot(
      emptyPointsJournal("2026-10-20T00:00:00.000Z"),
      snapshot(),
      "a".repeat(64),
      "2026-10-20T00:00:00.000Z",
    );
    const member = pointMembers(journal, "2026-10").find(
      (m) => m.actor.id === actor.id,
    );
    expect(member?.monthly).toBe(60);
    expect(member?.firstContributionAt).toBe(merged.occurredAt);
    expect(member?.badges).toEqual(["First accepted contribution"]);
    const debit = member?.awards.find(
      (a) => a.category === PENALTY_DEBIT_CATEGORY,
    );
    expect(debit?.amount).toBe(-30);
    expect(debit?.occurredAt).toBe("2026-10-16T00:00:00.000Z");
    journal = applyPointsSnapshot(
      journal,
      snapshot(),
      "a".repeat(64),
      "2026-10-20T00:00:00.000Z",
    );
    // Re-applying the same published debit is idempotent.
    expect(totalAfter([snapshot(), snapshot()])).toBe(60);
  });

  test("the journal rejects a wrong-sign penalty award", () => {
    const award = {
      key: "k".repeat(64),
      actor: { id: actor.id, login: actor.login },
      projectId: repository.projectId,
      category: PENALTY_DEBIT_CATEGORY,
      amount: 30,
      occurredAt: spam.occurredAt,
      sourceId: spam.id,
      sourceUrl: spam.source.url,
      workUnitId: spam.id,
      provisional: false,
    } as PointAward;
    expect(() =>
      appendPointAwards(
        emptyPointsJournal(spam.occurredAt),
        [award],
        "b".repeat(64),
        "slop-score-v2",
        spam.occurredAt,
      ),
    ).toThrow("Invalid point award");
  });
});

/** The published feed record for the fixture's Slopbot-closed pull request. */
const FEED = [
  {
    itemNodeId: CLOSED_PULL_REQUEST_ID,
    authorGithubId: "42",
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 3,
    period: "2026-11",
    recordedAt: "2026-11-10T00:00:00.000Z",
  },
];

function authorTotal(
  journal: ReturnType<typeof emptyPointsJournal>,
  month: string,
): number {
  return (
    pointMembers(journal, month).find((m) => m.actor.id === PENALIZED_AUTHOR.id)
      ?.total ?? 0
  );
}

describe("debit retention outside the published window", () => {
  // The fixture builds November and December 2026 snapshots, and a snapshot may
  // not be dated in the future. Reset after every test.
  afterEach(() => setSystemTime());

  test("a debit that ages out of the window is preserved, not reversed", () => {
    // The first snapshot carries the close of 2026-10-16 in its window, so the
    // debit is published and applied.
    const first = snapshot();
    let journal = applyPointsSnapshot(
      emptyPointsJournal(first.generatedAt),
      first,
      "b".repeat(64),
      first.generatedAt,
    );
    const before = totalAfter([first]);
    expect(journal.revisions.some((r) => r.award.amount < 0)).toBe(true);

    // The next snapshot moves its window forward, so the 35-day retention no
    // longer carries that close and publishes no debit for it. Absence is not a
    // reversal: the recorded debit must survive untouched.
    const later = {
      ...snapshot({ penalties: [] }),
      generatedAt: "2026-11-20T00:00:00.000Z",
      window: {
        from: "2026-10-20T00:00:00.000Z",
        to: "2026-11-20T00:00:00.000Z",
      },
    } as LeaderboardSnapshot;
    expect(later.penalties ?? []).toEqual([]);
    journal = applyPointsSnapshot(
      journal,
      later,
      "c".repeat(64),
      later.generatedAt,
    );
    expect(
      journal.revisions.some(
        (r) =>
          r.award.category === PENALTY_DEBIT_CATEGORY && r.award.amount === 0,
      ),
    ).toBe(false);
    const member = pointMembers(journal, "2026-10").find(
      (m) => m.actor.id === actor.id,
    );
    expect(member?.total).toBe(before);
  });

  test("a debit withdrawn inside the window is restored", () => {
    setSystemTime(new Date("2026-12-21T00:00:00.000Z"));
    const debited = createLeaderboardSnapshot(
      penaltyScoreInput(FEED, "2026-11-20T00:00:00.000Z"),
    );
    let journal = applyPointsSnapshot(
      emptyPointsJournal(debited.generatedAt),
      debited,
      "d".repeat(64),
      debited.generatedAt,
    );
    const withDebit = authorTotal(journal, "2026-11");

    // The feed no longer lists the debit, and its close is still inside the
    // window: this is an upheld appeal or a maintainer reopen.
    const cleared = createLeaderboardSnapshot(
      penaltyScoreInput([], "2026-11-20T00:00:00.000Z"),
    );
    journal = applyPointsSnapshot(
      journal,
      cleared,
      "e".repeat(64),
      cleared.generatedAt,
    );
    expect(authorTotal(journal, "2026-11")).toBeGreaterThan(withDebit);
    expect(
      journal.revisions.some(
        (r) =>
          r.award.category === PENALTY_DEBIT_CATEGORY && r.award.amount === 0,
      ),
    ).toBe(true);
  });
});

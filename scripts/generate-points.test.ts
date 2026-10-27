/// <reference types="bun-types" />
/**
 * Generator-level tests for the retained review history batch in
 * generate-points.ts: corrections, removals, replay, and rejection; and the
 * evaluated-review dedup of the points projection.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  createLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import type {
  LeaderboardInput,
  ScoreEvent,
} from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  applyPointsSnapshot,
  awardForScore,
  canonicalReviewIdentity,
  emptyPointsJournal,
  latestPoints,
  POINTS_RULE,
  type PointAward,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import {
  applyRetainedHistoryBatch,
  pointsSql,
  retainedHistoryAwards,
  retainedHistoryCorrections,
} from "./generate-points";

const DIGEST = "a".repeat(64);
const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-02T00:00:00.000Z";
const T2 = "2026-10-03T00:00:00.000Z";

it("replays an already completed older import without rolling back newer points", () => {
  const { sqlite: db } = sqliteD1(MIGRATIONS);
  const before = seedJournal(awardForScore(reviewEvent(3)));
  const after = appendPointAwards(
    before,
    [awardForScore(reviewEvent(1))],
    DIGEST,
    "slop-score-v2",
    T1,
  );
  const apply = (journal: PointsJournal) => {
    db.transaction(() => {
      for (const statement of pointsSql(journal).trim().split("\n"))
        db.exec(statement);
    })();
  };
  const rows = () =>
    db.query("SELECT id,payload FROM points_revisions ORDER BY rowid").all();
  try {
    apply(before);
    apply(after);
    const permanent = rows();
    expect(permanent).toHaveLength(2);
    expect(() => apply(before)).not.toThrow();
    expect(() => apply(after)).not.toThrow();
    expect(rows()).toEqual(permanent);
    expect(db.query("SELECT COUNT(*) AS n FROM points_batches").get()).toEqual({
      n: 2,
    });
    expect(db.query("SELECT COUNT(*) AS n FROM points_staging").get()).toEqual({
      n: 0,
    });
    // A previously unseen shorter batch must still fail the full-history gate.
    expect(() => apply({ ...before, generatedAt: T2 })).toThrow(
      "divergent points batch",
    );
    expect(rows()).toEqual(permanent);
  } finally {
    db.close();
  }
});

function reviewEvent(scoreThirds: number): ScoreEvent {
  return {
    id: "PR_kwDOMT5cIs8AAAABAr9NwA:reviewer:U_kgDOCzScNQ",
    actor: {
      id: "U_kgDOCzScNQ",
      login: "mashingaan",
      avatarUrl: "https://avatars.githubusercontent.com/u/187997237?v=4",
      url: "https://github.com/mashingaan",
      kind: "User",
    },
    category: "substantive-review",
    points: 1,
    scoreThirds,
    occurredAt: "2026-08-23T11:10:49.000Z",
    repository: "elizaOS/eliza",
    source: {
      id: "PRR_kwDOMT5cIs8AAAABKig2Kw",
      kind: "review",
      number: 25187,
      title: "test(app-core): cover electrobun window construction",
      url: "https://github.com/elizaOS/eliza/pull/25187#pullrequestreview-5002245675",
    },
    reason: "First qualifying substantive, non-self review before merge.",
    workUnitId: "wu_eliza_prr_kwdomt5cis8aaaabkig2kw",
  } as ScoreEvent;
}

const SNAPSHOT_DIGEST = "c".repeat(64);
const T3 = "2026-10-04T00:00:00.000Z";

function seedJournal(award: PointAward): PointsJournal {
  return appendPointAwards(
    emptyPointsJournal(T0),
    [award],
    DIGEST,
    "slop-score-v2",
    T0,
  );
}

/** A snapshot whose ledger lists the review event, as the leaderboard
 * generator produces after it injects the retained history events. */
function snapshotListing(event: ScoreEvent): LeaderboardSnapshot {
  return {
    ledger: [event],
    repositories: [{ id: "elizaOS/eliza" }],
    ruleVersion: "slop-score-v2",
    window: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-30T00:00:00.000Z",
    },
  } as unknown as LeaderboardSnapshot;
}

describe("retained review history corrections", () => {
  it("appends exactly one predecessor-linked revision for a changed award and updates the projection", () => {
    const before = awardForScore(reviewEvent(3));
    const after = awardForScore(reviewEvent(1));
    const journal = seedJournal(before);
    const next = appendPointAwards(
      journal,
      [after, ...retainedHistoryCorrections(journal, [after])],
      DIGEST,
      "slop-score-v2",
      T1,
    );
    expect(next.revisions.length).toBe(2);
    expect(next.revisions[1]?.previous).toBe(next.revisions[0]?.id);
    expect(next.revisions[1]?.award.amount).toBe(10);
    expect(latestPoints(next).get(before.key)?.award.amount).toBe(10);
    expect(pointMembers(next)[0]?.total).toBe(10);
  });

  it("is idempotent when the same retained input is replayed unchanged", () => {
    const award = awardForScore(reviewEvent(3));
    const journal = seedJournal(award);
    const replayed = appendPointAwards(
      journal,
      [award, ...retainedHistoryCorrections(journal, [award])],
      DIGEST,
      "slop-score-v2",
      T1,
    );
    expect(replayed.revisions.length).toBe(1);
    expect(replayed.revisions[0]?.id).toBe(journal.revisions[0]?.id);
  });

  it("appends one zero-valued successor when a retained review is removed, and replay adds no further revision", () => {
    const award = awardForScore(reviewEvent(3));
    const journal = seedJournal(award);
    const corrections = retainedHistoryCorrections(journal, []);
    expect(corrections).toEqual([{ ...award, amount: 0 }]);
    const corrected = appendPointAwards(
      journal,
      corrections,
      DIGEST,
      "slop-score-v2",
      T1,
    );
    expect(corrected.revisions.length).toBe(2);
    expect(corrected.revisions[1]?.previous).toBe(corrected.revisions[0]?.id);
    expect(latestPoints(corrected).get(award.key)?.award.amount).toBe(0);
    expect(pointMembers(corrected)).toEqual([]);
    const replayed = appendPointAwards(
      corrected,
      retainedHistoryCorrections(corrected, []),
      DIGEST,
      "slop-score-v2",
      T2,
    );
    expect(retainedHistoryCorrections(corrected, [])).toEqual([]);
    expect(replayed.revisions.length).toBe(2);
  });

  it("zeroes a removed retained award even when an archived snapshot still lists it", () => {
    const event = reviewEvent(3);
    const award = awardForScore(event);
    // The award entered the journal through the retained batch. A snapshot
    // generated afterwards lists the same event because the leaderboard
    // generator injects the retained history into its ledger; applying that
    // snapshot records its coverage but appends no revision for the
    // identical award, so the batch provenance is unchanged.
    const withSnapshot = applyPointsSnapshot(
      seedJournal(award),
      snapshotListing(event),
      SNAPSHOT_DIGEST,
      T1,
    );
    expect(withSnapshot.coverage.map((c) => c.digest)).toContain(
      SNAPSHOT_DIGEST,
    );
    expect(withSnapshot.revisions.length).toBe(1);
    // The maintainer then removes the entry from its manifest. The archived
    // snapshot copy must not suppress the correction forever.
    expect(retainedHistoryCorrections(withSnapshot, [])).toEqual([
      { ...award, amount: 0 },
    ]);
  });

  it("persists batch provenance in production order: snapshot, identical retained batch, then retained removal", () => {
    const event = reviewEvent(3);
    const award = awardForScore(event);
    // Production order in generatePoints: snapshots are applied first.
    // The snapshot ledger lists the retained event because the leaderboard
    // generator injects the retained history into its snapshots, so the
    // snapshot application creates the only revision and records its
    // digest in the journal coverage.
    let journal = applyPointsSnapshot(
      emptyPointsJournal(T0),
      snapshotListing(event),
      SNAPSHOT_DIGEST,
      T0,
    );
    expect(journal.revisions.length).toBe(1);
    expect(latestPoints(journal).get(award.key)?.sourceDigest).toBe(
      SNAPSHOT_DIGEST,
    );
    // The identical retained batch then supplies the same award. It must
    // persist explicit batch provenance even though the award itself is
    // unchanged: one provenance successor with the batch digest, the same
    // amount, linked to the snapshot revision.
    journal = applyRetainedHistoryBatch(journal, [award], DIGEST, T1);
    expect(journal.revisions.length).toBe(2);
    expect(journal.revisions[1]?.previous).toBe(journal.revisions[0]?.id);
    expect(journal.revisions[1]?.sourceDigest).toBe(DIGEST);
    expect(journal.revisions[1]?.sourceRule).toBe("slop-score-v2");
    expect(journal.revisions[1]?.award).toEqual(award);
    expect(pointMembers(journal)[0]?.total).toBe(30);
    // Replaying the identical retained batch appends no further revision.
    journal = applyRetainedHistoryBatch(journal, [award], DIGEST, T1);
    expect(journal.revisions.length).toBe(2);
    // The maintainer then removes the entry from the retained manifest.
    // The batch provenance, not the snapshot copy, decides: exactly one
    // zero-valued successor, and a replay of the removal adds nothing.
    journal = applyRetainedHistoryBatch(journal, [], DIGEST, T2);
    expect(journal.revisions.length).toBe(3);
    expect(journal.revisions[2]?.previous).toBe(journal.revisions[1]?.id);
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(0);
    expect(pointMembers(journal)).toEqual([]);
    journal = applyRetainedHistoryBatch(journal, [], DIGEST, T3);
    expect(journal.revisions.length).toBe(3);
  });

  it("never zeroes a snapshot-owned award when the old snapshot is absent from the current inputs", () => {
    const event = reviewEvent(3);
    const award = awardForScore(event);
    // The award entered the journal through a snapshot application, which
    // recorded the snapshot digest in the journal coverage. A later run
    // whose inputs no longer include that snapshot must leave the award
    // untouched: recorded totals persist subject to explicit corrections.
    const journal = applyPointsSnapshot(
      emptyPointsJournal(T0),
      snapshotListing(event),
      SNAPSHOT_DIGEST,
      T0,
    );
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(30);
    expect(retainedHistoryCorrections(journal, [])).toEqual([]);
    const next = appendPointAwards(
      journal,
      retainedHistoryCorrections(journal, []),
      DIGEST,
      "slop-score-v2",
      T1,
    );
    expect(next.revisions.length).toBe(1);
    expect(pointMembers(next)[0]?.total).toBe(30);
  });

  it("rejects a moved or invalid successor and leaves the journal unchanged", () => {
    const award = awardForScore(reviewEvent(3));
    const journal = seedJournal(award);
    const moved = { ...award, occurredAt: "2026-08-24T11:10:49.000Z" };
    expect(() =>
      appendPointAwards(journal, [moved], DIGEST, "slop-score-v2", T1),
    ).toThrow();
    expect(() =>
      appendPointAwards(
        journal,
        [{ ...award, amount: -10 }],
        DIGEST,
        "slop-score-v2",
        T1,
      ),
    ).toThrow();
    expect(journal.revisions.length).toBe(1);
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(30);
  });
});

/** A newer rolling snapshot whose window starts after the review was
 * submitted. It still evaluates the review with its in-window merge and,
 * when `excluded`, publishes the review in reviewExclusions. */
function newerSnapshot(
  event: ScoreEvent,
  excluded: boolean,
): LeaderboardSnapshot {
  const pullRequestId = event.id.split(":")[0];
  return {
    ledger: [],
    reviewExclusions: excluded
      ? [
          {
            id: `${pullRequestId}:review-exclusion:${event.source.id}`,
            reviewId: event.source.id,
            pullRequestId,
            pullRequestNumber: event.source.number,
            repository: "elizaOS/eliza",
            url: event.source.url,
            reason: "self-review",
          },
        ]
      : [],
    repositories: [{ id: "elizaOS/eliza" }],
    ruleVersion: "slop-score-v2",
    window: {
      from: "2026-09-11T23:36:56.000Z",
      to: "2026-10-16T23:36:56.000Z",
    },
  } as unknown as LeaderboardSnapshot;
}

describe("snapshot review exclusions", () => {
  it("zeroes a snapshot-sourced review that a newer snapshot excludes, even when the review predates its window", () => {
    const event = reviewEvent(3);
    const award = awardForScore(event);
    let journal = applyPointsSnapshot(
      emptyPointsJournal(T0),
      snapshotListing(event),
      SNAPSHOT_DIGEST,
      T0,
    );
    expect(pointMembers(journal)[0]?.total).toBe(30);
    expect(award.occurredAt < newerSnapshot(event, true).window.from).toBe(
      true,
    );
    journal = applyPointsSnapshot(
      journal,
      newerSnapshot(event, true),
      "d".repeat(64),
      T1,
    );
    expect(journal.revisions.length).toBe(2);
    expect(journal.revisions[1]?.previous).toBe(journal.revisions[0]?.id);
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(0);
    expect(pointMembers(journal)).toEqual([]);
    // A later snapshot with the same exclusion appends nothing.
    journal = applyPointsSnapshot(
      journal,
      newerSnapshot(event, true),
      "e".repeat(64),
      T2,
    );
    expect(journal.revisions.length).toBe(2);
  });

  it("keeps a pre-window review that a newer snapshot merely omits", () => {
    const event = reviewEvent(3);
    const award = awardForScore(event);
    const journal = applyPointsSnapshot(
      applyPointsSnapshot(
        emptyPointsJournal(T0),
        snapshotListing(event),
        SNAPSHOT_DIGEST,
        T0,
      ),
      newerSnapshot(event, false),
      "d".repeat(64),
      T1,
    );
    expect(journal.revisions.length).toBe(1);
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(30);
  });
});

/** The evaluator award event that loadEvaluatorAwardEvents returns for
 * evaluations/eliza/award-gg100-review-24433.json. Evaluator events carry no
 * workUnitId. */
function evaluatorEvent(): ScoreEvent {
  return {
    id: "award_gg100_review_24433",
    actor: {
      id: "U_kgDOCzOt4w",
      login: "GG100-eng",
      avatarUrl: "https://avatars.githubusercontent.com/u/187936227?v=4",
      url: "https://github.com/GG100-eng",
      kind: "User",
    },
    category: "evaluated-contribution",
    points: 4,
    occurredAt: "2026-08-22T12:55:00.000Z",
    repository: "elizaOS/eliza",
    source: {
      id: "PRR_kwDOMT5cIs8AAAABKglAuA",
      kind: "review",
      number: 24433,
      title:
        "feat(desktop): cloud-only settings panel with hardened Cloud contracts",
      url: "https://github.com/elizaOS/eliza/pull/24433#pullrequestreview-5000216760",
    },
    reason:
      "The exact-head review found 24 static translation keys absent from the canonical English catalog and an exact-head Biome failure; the author added the entries and fixed the formatter failure.",
    evaluation: {
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/248",
      reviewedAt: "2026-08-24T07:35:00.000Z",
      reviewer: "lalalune",
      manifestPath: "evaluations/eliza/award-gg100-review-24433.json",
      manifestSha256: "c".repeat(64),
    },
  } as ScoreEvent;
}

/** A scheduled refresh: the real scorer, with the evaluator event injected
 * as generate-leaderboard.ts does, and no GitHub activity. */
function refreshedSnapshot(generatedAt: string): LeaderboardSnapshot {
  const from = "2026-08-01T00:00:00.000Z";
  const to = "2026-09-05T00:00:00.000Z";
  return createLeaderboardSnapshot({
    generatedAt,
    windowFrom: from,
    windowTo: to,
    sourceUpdatedAt: to,
    source: {
      provider: "github-graphql",
      fetchedAt: generatedAt,
      cutoffAt: to,
      repositoryId: "R_fixture",
      repositories: TARGET_REPOSITORIES.map((repository) => ({
        id: repository.id,
        repositoryId:
          repository.role === "primary"
            ? "R_fixture"
            : `R_fixture_${repository.name.replaceAll("-", "_")}`,
      })),
      requestCount: 1,
      searchSliceCount: 1,
      rateLimit: {
        cost: 1,
        limit: 5000,
        remaining: 4999,
        resetAt: "2026-09-05T01:00:00.000Z",
      },
      counts: {
        mergedPullRequests: 0,
        detailedMergedPullRequests: 0,
        closedIssues: 0,
        detailedClosedIssues: 0,
        resolvedIssues: 0,
        openIssues: 0,
        openPullRequests: 0,
      },
      verificationWindow: { days: 35, from, to },
      evidenceVerification: {
        status: "complete",
        sourceCount: 0,
        artifactCount: 0,
        maxSources: 64,
        maxArtifacts: 64,
      },
    },
    mergedPullRequestOutcomes: [],
    mergedPullRequests: [],
    detailEligibleMergedPullRequestIds: [],
    closedIssueCount: 0,
    resolvedIssues: [],
    openIssues: [],
    openPullRequests: [],
    verificationWindowFrom: from,
    verifiedEvidence: [],
    evaluatedContributions: [evaluatorEvent()],
  } as unknown as LeaderboardInput);
}

function digestOf(snapshot: LeaderboardSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

describe("evaluator awards across snapshot refreshes", () => {
  it("converts an evaluator event to the same award as its snapshot ledger copy", () => {
    const ledger = refreshedSnapshot(T0).ledger.filter(
      (event) => event.category === "evaluated-contribution",
    );
    expect(ledger.length).toBe(1);
    expect(retainedHistoryAwards([evaluatorEvent()])).toEqual(
      ledger.map(awardForScore),
    );
  });

  it("appends no revision when unchanged inputs are replayed with a new snapshot", () => {
    const awards = retainedHistoryAwards([evaluatorEvent()]);
    // Production order in generatePoints: each run applies the new snapshot,
    // then the retained batch. Every scheduled refresh has a new digest.
    let journal = emptyPointsJournal(T0);
    const counts: number[] = [];
    for (const at of [T1, T2, T3]) {
      const snapshot = refreshedSnapshot(at);
      journal = applyPointsSnapshot(journal, snapshot, digestOf(snapshot), at);
      journal = applyRetainedHistoryBatch(journal, awards, DIGEST, at);
      counts.push(journal.revisions.length);
    }
    expect(counts).toEqual([2, 2, 2]);
    expect(pointMembers(journal)[0]?.total).toBe(120);
  });
});

describe("snapshots never rewrite batch-owned retained awards", () => {
  /** The same refresh, but its ledger omits the evaluator award (for
   * example, a repeat work unit that the v2 ledger path drops). */
  function omittingSnapshot(generatedAt: string): LeaderboardSnapshot {
    const snapshot = refreshedSnapshot(generatedAt);
    return {
      ...snapshot,
      ledger: snapshot.ledger.filter(
        (event) => event.category !== "evaluated-contribution",
      ),
    };
  }

  it("appends no revision when a snapshot omits a batch-owned award inside its window", () => {
    const awards = retainedHistoryAwards([evaluatorEvent()]);
    let journal = applyRetainedHistoryBatch(
      emptyPointsJournal(T0),
      awards,
      DIGEST,
      T0,
    );
    const settled = journal.revisions.length;
    const counts: number[] = [];
    for (const at of [T1, T2, T3]) {
      const snapshot = omittingSnapshot(at);
      journal = applyPointsSnapshot(journal, snapshot, digestOf(snapshot), at);
      journal = applyRetainedHistoryBatch(journal, awards, DIGEST, at);
      counts.push(journal.revisions.length);
    }
    expect(counts).toEqual([settled, settled, settled]);
    expect(pointMembers(journal)[0]?.total).toBe(120);
  });

  it("lets a snapshot take over an award after the retained batch zeroes it", () => {
    const awards = retainedHistoryAwards([evaluatorEvent()]);
    let journal = applyRetainedHistoryBatch(
      emptyPointsJournal(T0),
      awards,
      DIGEST,
      T0,
    );
    journal = applyRetainedHistoryBatch(journal, [], DIGEST, T1);
    const award = awards[0] as PointAward;
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(0);
    const snapshot = refreshedSnapshot(T2);
    const digest = digestOf(snapshot);
    journal = applyPointsSnapshot(journal, snapshot, digest, T2);
    const latest = latestPoints(journal).get(award.key);
    expect(latest?.award.amount).toBe(120);
    expect(latest?.sourceDigest).toBe(digest);
  });
});

const AT = "2026-10-14T17:30:00.000Z";
const MONTH = "2026-10";

function award(over: Partial<PointAward> & { key: string }): PointAward {
  return {
    actor: { id: "1", login: "alice" },
    projectId: "slopdotcash",
    category: "evaluated-contribution",
    amount: 100,
    occurredAt: `${MONTH}-05T10:00:00.000Z`,
    sourceId: "e1",
    sourceUrl: "https://github.com/SlopDotCash/slopdotcash/pull/5",
    workUnitId: "w1",
    provisional: false,
    ...over,
  };
}

function journal(awards: PointAward[]): PointsJournal {
  return {
    schemaVersion: "1",
    ruleVersion: POINTS_RULE,
    generatedAt: AT,
    coverage: [],
    revisions: awards.map((a, i) => ({
      id: `r${i}`,
      previous: null,
      recordedAt: AT,
      sourceDigest: "digest",
      sourceRule: POINTS_RULE,
      award: a,
    })),
  };
}

function aliceTotal(j: PointsJournal): number {
  return pointMembers(j, MONTH)[0]?.total ?? 0;
}

describe("evaluated-review dedup set fragment scoping", () => {
  it("dedups a substantive review when the evaluated award uses a discussion_r URL", () => {
    const evaluated = award({
      key: "e1",
      category: "evaluated-contribution",
      amount: 100,
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#discussion_r123",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#pullrequestreview-1",
      workUnitId: "w2",
    });
    expect(aliceTotal(journal([evaluated, review]))).toBe(100);
  });

  it("still dedups through the legacy pullrequestreview fragment", () => {
    const evaluated = award({
      key: "e1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#pullrequestreview-9",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#pullrequestreview-1",
      workUnitId: "w2",
    });
    expect(aliceTotal(journal([evaluated, review]))).toBe(100);
  });

  it("does not let a non-evaluated discussion_r award populate the dedup set", () => {
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#discussion_r123",
      workUnitId: "w2",
    });
    // Without the parentheses the fragment disjunction escapes the
    // amount/category predicates, so this review suppresses itself.
    expect(aliceTotal(journal([review]))).toBe(10);
  });

  it("does not let a zero-amount discussion_r award populate the dedup set", () => {
    const correction = award({
      key: "e0",
      amount: 0,
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#discussion_r1",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#discussion_r123",
      workUnitId: "w2",
    });
    expect(aliceTotal(journal([correction, review]))).toBe(10);
  });

  it("dedups when the evaluated award URL differs only in repo-path casing", () => {
    const evaluated = award({
      key: "e1",
      category: "evaluated-contribution",
      amount: 100,
      sourceUrl:
        "https://github.com/slopdotcash/SLOPDOTCASH/pull/5#discussion_r123",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#pullrequestreview-1",
      workUnitId: "w2",
    });
    // The journal validator accepts owner/repo casing variants and preserves
    // the raw URL; without case normalization the dedup key misses and the
    // substantive review double-counts (110 instead of 100).
    expect(aliceTotal(journal([evaluated, review]))).toBe(100);
  });

  it.each([
    [
      "mixed-case review fragment",
      "https://github.com/SlopDotCash/slopdotcash/pull/5#Discussion_R123",
    ],
    [
      "explicit default port",
      "https://github.com:443/SlopDotCash/slopdotcash/pull/5#discussion_r123",
    ],
    [
      "empty query marker",
      "https://github.com/SlopDotCash/slopdotcash/pull/5?#discussion_r123",
    ],
    [
      "dot-segment path",
      "https://github.com/SlopDotCash/slopdotcash/tmp/../pull/5#discussion_r123",
    ],
    [
      "percent-encoded dot-segment path",
      "https://github.com/SlopDotCash/slopdotcash/%2e/pull/5#discussion_r123",
    ],
  ])(
    "dedups when the evaluated award URL is a validator-accepted variant (%s)",
    (_name, sourceUrl) => {
      const evaluated = award({
        key: "e1",
        category: "evaluated-contribution",
        amount: 100,
        sourceUrl,
        workUnitId: "w1",
      });
      const review = award({
        key: "r1",
        category: "substantive-review",
        amount: 10,
        sourceId: "s1",
        sourceUrl:
          "https://github.com/SlopDotCash/slopdotcash/pull/5#pullrequestreview-1",
        workUnitId: "w2",
      });
      // assertEvaluatorAwardManifest accepts each variant and keeps the raw
      // string; keying the dedup set on the raw URL lets them evade the
      // evaluated-review suppression and double-count (110 instead of 100).
      expect(aliceTotal(journal([evaluated, review]))).toBe(100);
    },
  );

  it("dedups when the evaluated award uses a registered repository alias and the review uses the canonical id", () => {
    const evaluated = award({
      key: "e1",
      projectId: "asi",
      category: "evaluated-contribution",
      amount: 100,
      sourceUrl: "https://github.com/SlopDotCash/asi/pull/1#discussion_r1",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      projectId: "asi",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl: "https://github.com/elizaOS/asi/pull/1#pullrequestreview-2",
      workUnitId: "w2",
    });
    // The journal validator accepts the alias path (SlopDotCash/asi) as a
    // review source for the canonically-registered elizaOS/asi repository.
    // Without alias canonicalization the two URLs yield different dedup
    // identities and the substantive review double-counts (110 instead of
    // 100), bypassing the PRD section 14 no-duplicate rule.
    expect(aliceTotal(journal([evaluated, review]))).toBe(100);
  });

  it.each([
    [
      "explicit non-default port",
      "https://github.com:444/SlopDotCash/slopdotcash/pull/5#discussion_r1",
    ],
    [
      "non-empty query",
      "https://github.com/SlopDotCash/slopdotcash/pull/5?x=1#discussion_r1",
    ],
  ])(
    "yields no identity for a review URL the journal validator rejects (%s)",
    (_name, sourceUrl) => {
      // assertEvaluatorAwardManifest rejects both forms while the helper
      // used to return an identity, so such a URL could falsely suppress
      // credit for a legitimate review.
      expect(canonicalReviewIdentity(sourceUrl)).toBeUndefined();
    },
  );

  it("does not dedup a substantive review for a different PR number", () => {
    const evaluated = award({
      key: "e1",
      category: "evaluated-contribution",
      amount: 100,
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/6#discussion_r123",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#pullrequestreview-1",
      workUnitId: "w2",
    });
    // Same repo, different PR: genuinely different work units, so both count.
    expect(aliceTotal(journal([evaluated, review]))).toBe(110);
  });

  it("does not dedup a substantive review whose URL is not a review URL", () => {
    const evaluated = award({
      key: "e1",
      category: "evaluated-contribution",
      amount: 100,
      sourceUrl:
        "https://github.com/SlopDotCash/slopdotcash/pull/5#discussion_r123",
      workUnitId: "w1",
    });
    const review = award({
      key: "r1",
      category: "substantive-review",
      amount: 10,
      sourceId: "s1",
      sourceUrl: "https://github.com/SlopDotCash/slopdotcash/pull/5",
      workUnitId: "w2",
    });
    // A fragment-free URL is not a review identity, so the canonical dedup
    // never suppresses it; the points engine still counts it.
    expect(aliceTotal(journal([evaluated, review]))).toBe(110);
  });
});

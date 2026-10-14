/// <reference types="bun-types" />
/**
 * Generator-level tests for the retained review history batch in
 * generate-points.ts: corrections, removals, replay, and rejection.
 */
import { describe, expect, it } from "bun:test";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import type { ScoreEvent } from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  applyPointsSnapshot,
  awardForScore,
  emptyPointsJournal,
  latestPoints,
  type PointAward,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import {
  applyRetainedHistoryBatch,
  retainedHistoryCorrections,
} from "./generate-points";

const DIGEST = "a".repeat(64);
const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-02T00:00:00.000Z";
const T2 = "2026-10-03T00:00:00.000Z";

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

/** An evaluator award event as loadEvaluatorAwardEvents returns it: the
 * manifest supplies no workUnitId, so awardForScore records the manifest id. */
function evaluatorEvent(): ScoreEvent {
  return {
    id: "award_gg100_review_24433",
    actor: {
      id: "U_kgDOCzOt4w",
      login: "GG100-eng",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
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
      title: "evaluated review",
      url: "https://github.com/elizaOS/eliza/pull/24433#pullrequestreview-5000216760",
    },
    reason: "Maintainer-evaluated contribution.",
  } as ScoreEvent;
}

/** The leaderboard generator's v2 ledger copy of the same event: it adds
 * integer thirds and derives wu_<project>_<source id> for the work unit. */
function ledgerCopy(event: ScoreEvent): ScoreEvent {
  return {
    ...event,
    points: 4,
    scoreThirds: 12,
    workUnitId: "wu_eliza_prr_kwdomt5cis8aaaabkglaua",
  } as ScoreEvent;
}

function run(
  journal: PointsJournal,
  ledger: ScoreEvent[],
  snapshotDigest: string,
  retained: PointAward[],
  at: string,
): PointsJournal {
  // Production order in generatePoints: each run reads a freshly generated
  // public/data/leaderboard.json (new digest), then the retained batch.
  const snapshot = {
    ...snapshotListing(ledger[0] ?? evaluatorEvent()),
    ledger,
  } as LeaderboardSnapshot;
  return applyRetainedHistoryBatch(
    applyPointsSnapshot(journal, snapshot, snapshotDigest, at),
    retained,
    DIGEST,
    at,
  );
}

describe("snapshots never rewrite batch-owned retained awards", () => {
  it("appends nothing on later runs when the snapshot copy differs from the retained award", () => {
    const event = evaluatorEvent();
    const award = awardForScore(event);
    expect(awardForScore(ledgerCopy(event)).amount).toBe(award.amount);
    let journal = run(
      emptyPointsJournal(T0),
      [ledgerCopy(event)],
      "1".repeat(64),
      [award],
      T0,
    );
    const settled = journal.revisions.length;
    expect(latestPoints(journal).get(award.key)?.award).toEqual(award);
    journal = run(journal, [ledgerCopy(event)], "2".repeat(64), [award], T1);
    journal = run(journal, [ledgerCopy(event)], "3".repeat(64), [award], T2);
    expect(journal.revisions.length).toBe(settled);
    expect(latestPoints(journal).get(award.key)?.award).toEqual(award);
    expect(pointMembers(journal)[0]?.total).toBe(120);
  });

  it("does not zero a batch-owned retained award that the snapshot ledger omits", () => {
    const event = evaluatorEvent();
    const award = awardForScore(event);
    // e.g. the generator drops it as a second credit for an already credited
    // work unit. The window covers the award and every project repository.
    let journal = run(emptyPointsJournal(T0), [], "1".repeat(64), [award], T0);
    const settled = journal.revisions.length;
    journal = run(journal, [], "2".repeat(64), [award], T1);
    journal = run(journal, [], "3".repeat(64), [award], T2);
    expect(journal.revisions.length).toBe(settled);
    expect(journal.revisions.every((r) => r.award.amount === 120)).toBe(true);
  });

  it("still lets a snapshot take over once the retained batch has zeroed the award", () => {
    const event = evaluatorEvent();
    const award = awardForScore(event);
    let journal = run(emptyPointsJournal(T0), [], "1".repeat(64), [award], T0);
    journal = run(journal, [], "2".repeat(64), [], T1);
    expect(latestPoints(journal).get(award.key)?.award.amount).toBe(0);
    journal = run(journal, [ledgerCopy(event)], "3".repeat(64), [], T2);
    const owned = latestPoints(journal).get(award.key);
    expect(owned?.award.amount).toBe(120);
    expect(owned?.sourceDigest).toBe("3".repeat(64));
    const settled = journal.revisions.length;
    journal = run(journal, [ledgerCopy(event)], "4".repeat(64), [], T3);
    expect(journal.revisions.length).toBe(settled);
  });
});

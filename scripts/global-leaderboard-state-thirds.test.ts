/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * B8 + B10 (first-round audit, base 6159e313): the global leaderboard
 * counts any cycle-index entry as archived, and it rebuilds a missing
 * scoreThirds from the floored score.
 *
 * B8: a `review`-state cycle is published by scripts/sync-cycle-index.ts
 * (state is "review" while proposal.json exists and allocation.json does
 * not) and validated by assertCycleIndex, yet its contributor scores are
 * only proposed — the creator may still exclude, reduce or increase rows
 * during the 14-day public review. createGlobalLeaders must not count
 * those proposed scores, and openMonthScores must not hide the month's
 * rolling events behind them; the rolling ledger is the month's score
 * until the cycle is approved.
 *
 * B10: score is Math.floor(scoreThirds / 3), so scoreThirds is the only
 * exact value. The validator accepts a contributor without scoreThirds,
 * and createGlobalLeaders then counts score * 3, silently losing the
 * remainder (up to 2 thirds per contributor).
 *
 * Both cases run against the repository's own fixtures and functions:
 * snapshotFixture()/archivedPaidCycleIndex() from tests/fixtures.ts,
 * assertCycleIndex from src/lib/cycle-index.ts, and
 * createGlobalLeaders/openMonthScores from
 * src/lib/global-leaderboard.ts.
 */
import { describe, expect, test } from "bun:test";
import { assertCycleIndex, type CycleIndex } from "../src/lib/cycle-index";
import {
  createGlobalLeaders,
  openMonthScores,
} from "../src/lib/global-leaderboard";
import { archivedPaidCycleIndex, snapshotFixture } from "../tests/fixtures";

/** The paid eliza 2026-07 fixture, retargeted at exact thirds. */
function exactPaidCycle(scoreThirds: number): CycleIndex {
  const index = archivedPaidCycleIndex();
  const cycle = index.cycles[0];
  if (!cycle) throw new Error("paid cycle fixture is empty");
  cycle.contributors[0].scoreThirds = scoreThirds;
  cycle.contributors[0].score = Math.floor(scoreThirds / 3);
  return index;
}

/**
 * The same cycle as published while it is still inside its public review
 * window: no allocation, no approval, no payment, contributor unclaimed.
 * This is exactly what scripts/sync-cycle-index.ts emits for a proposal
 * without allocation.json, and assertCycleIndex accepts it.
 */
function reviewCycle(scoreThirds: number): CycleIndex {
  const index = exactPaidCycle(scoreThirds);
  const cycle = index.cycles[0];
  if (!cycle) throw new Error("paid cycle fixture is empty");
  cycle.state = "review";
  cycle.approvedAt = null;
  cycle.settledAt = null;
  cycle.files.allocation = null;
  cycle.files.executionPlan = null;
  cycle.files.settlement = null;
  cycle.reward.approvedMinor = "0";
  cycle.reward.paidMinor = "0";
  cycle.reward.feeMinor = "0";
  const contributor = cycle.contributors[0];
  if (!contributor) throw new Error("paid cycle fixture has no contributor");
  contributor.state = "unclaimed";
  contributor.wallet = null;
  contributor.approvedMinor = "0";
  contributor.paidMinor = "0";
  return index;
}

/** Score of one actor in the global leaderboard, in Points. */
function globalScore(
  snapshot: ReturnType<typeof snapshotFixture>,
  index: CycleIndex,
  actorId: string,
): number | undefined {
  return createGlobalLeaders(snapshot, [], index).find(
    (leader) => leader.actor.id === actorId,
  )?.score;
}

describe("global leaderboard cycle states and thirds (B8, B10)", () => {
  test("B8: a review-state cycle is published and validated", () => {
    const index = reviewCycle(22);
    expect(() => assertCycleIndex(index)).not.toThrow();
    expect(index.cycles[0]?.state).toBe("review");
  });

  test("B8: review scores do not replace the rolling month", () => {
    const snapshot = snapshotFixture();
    // The fixture ledger holds 102 thirds (34 Points) for U_fixture in
    // 2026-07: 72 thirds of eliza events plus 30 thirds of a
    // proximityprize merge. The paid eliza 2026-07 cycle archives only
    // the eliza month, so the proximityprize merge stays open.
    expect(globalScore(snapshot, exactPaidCycle(22), "U_fixture")).toBe(10);
    expect(globalScore(snapshot, exactPaidCycle(22), "U_archived")).toBe(
      22 / 3,
    );

    // A review-state cycle must change neither half: the proposed
    // contributor is not counted, and the month's rolling events stay
    // open, so U_fixture keeps the full 34 Points and U_archived has
    // no global score at all.
    const review = reviewCycle(22);
    expect(
      openMonthScores(snapshot, review).openEvents.filter(
        (event) => event.repository === "elizaOS/eliza",
      ).length,
    ).toBeGreaterThan(0);
    expect(globalScore(snapshot, review, "U_fixture")).toBe(34);
    expect(globalScore(snapshot, review, "U_archived")).toBeUndefined();
  });

  test("B10: the exact thirds survive, and a missing field is refused", () => {
    const snapshot = snapshotFixture();
    // The shared paid-cycle fixture carries its exact thirds (21 for
    // score 7) and still validates under the stricter rule.
    expect(() => assertCycleIndex(archivedPaidCycleIndex())).not.toThrow();
    // score 10 is floor(32 / 3): the exact value is 32 thirds.
    const exact = exactPaidCycle(32);
    expect(() => assertCycleIndex(exact)).not.toThrow();
    expect(globalScore(snapshot, exact, "U_archived")).toBe(32 / 3);

    // On the base revision the validator accepted this omission and the
    // leaderboard counted 10 * 3 = 30 thirds instead of 32. The field is
    // now required, so the entry is refused instead of silently
    // undercounting its contributor.
    const legacy = archivedPaidCycleIndex();
    const contributor = legacy.cycles[0]?.contributors[0];
    if (!contributor) throw new Error("paid cycle fixture is empty");
    contributor.score = 10;
    delete (contributor as Partial<typeof contributor>).scoreThirds;
    expect(() => assertCycleIndex(legacy)).toThrow(
      /unexpected or missing fields/,
    );

    // A present but inconsistent field is refused the same way.
    const inconsistent = exactPaidCycle(32);
    const row = inconsistent.cycles[0]?.contributors[0];
    if (!row) throw new Error("paid cycle fixture is empty");
    row.scoreThirds = 33;
    expect(() => assertCycleIndex(inconsistent)).toThrow(
      /scoreThirds is invalid/,
    );
  });
});

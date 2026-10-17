/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyFundingReviewSubmission } from "../src/lib/funding-review-submission";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  assertRewardAllocationManifest,
  type RewardAllocation,
  type RewardAllocationManifest,
} from "../src/lib/rewards";
import {
  assertAllocationsMatchBaseline,
  verifyProposalAgainstSnapshot,
} from "./sync-cycle-index";

// cycles/README.md: "A creator may approve, hold, exclude, reduce, or increase
// any row during the 14-day public review." The funding review page and
// scripts/apply-funding-review.ts write such a change into a candidate
// proposal.json: the new total, a public reason and a renewed review window.
// cycles:check then compares the proposal with the proposal regenerated from
// its frozen snapshot. The July Eliza cycle is the published cycle with funded
// rows, so its review is replayed here at a time inside its review window.
const root = resolve(import.meta.dir, "..");
const directory = resolve(root, "cycles/eliza/2026-07");
const source = readFileSync(resolve(directory, "proposal.json"));
const snapshotBytes = readFileSync(resolve(directory, "source-snapshot.json"));
const snapshot = JSON.parse(
  snapshotBytes.toString("utf8"),
) as LeaderboardSnapshot;
const frozen = assertRewardAllocationManifest(
  JSON.parse(source.toString("utf8")),
);
const duringReview = Date.parse("2026-08-25T00:00:00.000Z");
const REASON = "Adjusted after the public review of the merged work.";
const [first, second] = frozen.allocations.filter(
  (row) => row.suggestedMinor !== "0",
);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The candidate that the funding review writes for these decisions. */
function review(
  adjustments: {
    actorId: string;
    decision: "include" | "exclude";
    amountMinor: string;
  }[],
): Promise<RewardAllocationManifest> {
  return applyFundingReviewSubmission(
    source,
    {
      schemaVersion: "1",
      kind: "funding-review-submission",
      projectId: frozen.projectId,
      cycleId: frozen.cycleId,
      sourceProposalSha256: sha256(source),
      adjustments: adjustments.map((row) => ({ ...row, reason: REASON })),
    },
    duringReview,
  );
}

/** What cycles:check runs on a committed proposal.json. */
function check(proposal: RewardAllocationManifest): Promise<void> {
  return verifyProposalAgainstSnapshot(
    assertRewardAllocationManifest(JSON.parse(JSON.stringify(proposal))),
    snapshot,
    sha256(snapshotBytes),
  );
}

/** Rewrites one row and keeps the totals consistent with the rows. */
function edit(
  proposal: RewardAllocationManifest,
  actorId: string,
  change: Partial<RewardAllocation>,
): RewardAllocationManifest {
  const allocations = proposal.allocations.map((row) =>
    row.actor.id === actorId ? { ...row, ...change } : row,
  );
  const suggestedMinor = allocations
    .reduce((sum, row) => sum + BigInt(row.suggestedMinor), 0n)
    .toString();
  return {
    ...proposal,
    allocations,
    totals: { ...proposal.totals, suggestedMinor },
  };
}

const half = (amount: string) => (BigInt(amount) / 2n).toString();

describe("review amount changes against the frozen snapshot", () => {
  it("still accepts the published proposal", async () => {
    await check(frozen);
  });

  it("accepts a row that the review reduced", async () => {
    const reviewed = await review([
      {
        actorId: first.actor.id,
        decision: "include",
        amountMinor: half(first.suggestedMinor),
      },
    ]);
    await check(reviewed);
  });

  it("accepts a funded row that the review excluded", async () => {
    const reviewed = await review([
      { actorId: second.actor.id, decision: "exclude", amountMinor: "0" },
    ]);
    expect(
      reviewed.allocations.find((row) => row.actor.id === second.actor.id)
        ?.state,
    ).toBe("excluded");
    await check(reviewed);
  });

  it("accepts an increase that a reduction in the same review pays for", async () => {
    const moved = BigInt(half(first.suggestedMinor));
    const reviewed = await review([
      {
        actorId: first.actor.id,
        decision: "include",
        amountMinor: (BigInt(first.suggestedMinor) - moved).toString(),
      },
      {
        actorId: second.actor.id,
        decision: "include",
        amountMinor: (BigInt(second.suggestedMinor) + moved).toString(),
      },
    ]);
    expect(reviewed.totals.suggestedMinor).toBe(frozen.capMinor);
    await check(reviewed);
  });

  it("refuses a changed amount without a public reason", async () => {
    const reviewed = await review([
      {
        actorId: first.actor.id,
        decision: "include",
        amountMinor: half(first.suggestedMinor),
      },
    ]);
    await expect(
      check(edit(reviewed, first.actor.id, { adjustmentReason: null })),
    ).rejects.toThrow("differs from its frozen snapshot");
  });

  it("refuses a changed amount that keeps the frozen review window", async () => {
    const reviewed = await review([
      {
        actorId: first.actor.id,
        decision: "include",
        amountMinor: half(first.suggestedMinor),
      },
    ]);
    await expect(check({ ...reviewed, review: frozen.review })).rejects.toThrow(
      "differs from its frozen snapshot",
    );
  });

  it("refuses an increase above the monthly cap plus carry", async () => {
    // The funding review refuses this increase, so the renewed window is
    // taken from another reviewed candidate.
    const { review: renewed } = await review([
      {
        actorId: first.actor.id,
        decision: "include",
        amountMinor: half(first.suggestedMinor),
      },
    ]);
    const raisedMinor = (BigInt(second.suggestedMinor) + 1n).toString();
    const raised = edit(frozen, second.actor.id, {
      suggestedMinor: raisedMinor,
      accruedMinor: raisedMinor,
      adjustmentReason: REASON,
    });
    expect(BigInt(raised.totals.suggestedMinor)).toBe(
      BigInt(frozen.capMinor) + 1n,
    );
    await expect(check({ ...raised, review: renewed })).rejects.toThrow(
      "differs from its frozen snapshot",
    );
  });

  it("refuses an excluded row that keeps an amount", async () => {
    const reviewed = await review([
      { actorId: second.actor.id, decision: "exclude", amountMinor: "0" },
    ]);
    await expect(
      check(
        edit(reviewed, second.actor.id, {
          suggestedMinor: half(second.suggestedMinor),
          accruedMinor: half(second.suggestedMinor),
        }),
      ),
    ).rejects.toThrow("differs from its frozen snapshot");
  });
});

// The July cycle has no separate review-budget line, so the line rule is
// checked on one frozen row that has one.
describe("review amount changes with a review-budget line", () => {
  const reviewMinor = 1_000_000n;
  const total = BigInt(first.suggestedMinor);
  const reviewBudget = {
    suggestedMinor: reviewMinor.toString(),
    approvedMinor: "0",
    evidenceEventIds: first.evidenceEventIds.slice(0, 1),
  };
  const lined: RewardAllocation = {
    ...first,
    lines: {
      sharedPool: {
        suggestedMinor: (total - reviewMinor).toString(),
        approvedMinor: "0",
      },
      reviewBudget,
    },
  };
  const match = (row: RewardAllocation) =>
    assertAllocationsMatchBaseline(
      { ...frozen, allocations: [row] },
      { allocations: [lined] },
      new Map(),
    );
  const lines = (shared: bigint, review: bigint) => ({
    sharedPool: { suggestedMinor: shared.toString(), approvedMinor: "0" },
    reviewBudget: { ...reviewBudget, suggestedMinor: review.toString() },
  });

  it("accepts a reduction that keeps the review line", () => {
    const reduced = total / 2n;
    match({
      ...lined,
      suggestedMinor: reduced.toString(),
      accruedMinor: reduced.toString(),
      adjustmentReason: REASON,
      lines: lines(reduced - reviewMinor, reviewMinor),
    });
  });

  it("accepts an exclusion that clears both lines", () => {
    match({
      ...lined,
      suggestedMinor: "0",
      accruedMinor: "0",
      state: "excluded",
      adjustmentReason: REASON,
      lines: lines(0n, 0n),
    });
  });

  it("refuses an included row that moves its review line into the shared pool", () => {
    const reduced = total / 2n;
    expect(() =>
      match({
        ...lined,
        suggestedMinor: reduced.toString(),
        accruedMinor: reduced.toString(),
        adjustmentReason: REASON,
        lines: lines(reduced, 0n),
      }),
    ).toThrow("differs from its frozen snapshot");
  });
});

/**
 * Closes a reward proposal whose public review window ended with no creator
 * decision. The transition is mechanical and one-directional: it can only move
 * an undecided row to a held, zero-approval state. It never approves an amount,
 * never selects a destination, and never signs or broadcasts anything.
 *
 * Without it a single undecided row keeps a cycle in `proposed` forever, because
 * every writer of allocation state refuses once `review.endsAt` has passed while
 * finalization refuses while any row is still `proposed`. That deadlock is the
 * shape a slow-rolled sponsor leaves behind, so the lapse is the deadline that
 * the funding rail otherwise has no way to enforce.
 */

import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
} from "./rewards";

function exactUtc(value: string, field: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} must be an exact UTC timestamp`);
  }
  return Date.parse(value);
}

/** The public reason recorded on every row the creator left undecided. */
export function reviewLapseReason(endsAt: string): string {
  return `Public review closed at ${endsAt} with no creator decision on this row. Recorded as a review lapse, not as a decision against the contributor. The frozen suggestion carries forward and no payment is scheduled.`;
}

/**
 * Marks an expired proposal as lapsed, resolving every undecided row.
 * Rows the creator already decided are returned untouched.
 */
export function lapseRewardAllocation(
  untrustedProposal: unknown,
  lapsedAt: string,
  now = Date.now(),
): RewardAllocationManifest {
  const proposal = assertRewardAllocationManifest(untrustedProposal);
  if (proposal.status !== "proposed") {
    throw new TypeError("Only a proposed reward allocation can lapse");
  }
  if (proposal.review.lapsedAt) {
    throw new TypeError("Reward allocation has already lapsed");
  }
  if (!Number.isFinite(now)) throw new TypeError("Current time must be finite");
  const lapseTime = exactUtc(lapsedAt, "lapsedAt");
  if (lapseTime > now + 5 * 60_000) {
    throw new RangeError("Reward allocation lapse cannot be in the future");
  }
  if (lapseTime < Date.parse(proposal.review.endsAt)) {
    throw new RangeError("Reward allocation review period has not ended");
  }
  // A creator who approved anything has used the authority the window exists
  // for, so the cycle belongs on the ordinary finalization path instead.
  if (
    proposal.totals.approvedMinor !== "0" ||
    proposal.allocations.some(
      (allocation) =>
        allocation.state === "approved" || allocation.approvedMinor !== "0",
    )
  ) {
    throw new TypeError(
      "A reward allocation with approved amounts cannot lapse",
    );
  }
  const undecided = proposal.allocations.filter(
    (allocation) => allocation.state === "proposed",
  );
  if (undecided.length === 0) {
    throw new RangeError("Reward allocation has no undecided rows to lapse");
  }
  const reason = reviewLapseReason(proposal.review.endsAt);
  return assertRewardAllocationManifest({
    ...proposal,
    review: { ...proposal.review, lapsedAt },
    allocations: proposal.allocations.map((allocation) =>
      allocation.state === "proposed"
        ? {
            ...allocation,
            state: "held",
            approvedMinor: "0",
            adjustmentReason: reason,
            hold: { kind: "review-lapsed", lapsedAt },
            platformApproval: null,
          }
        : allocation,
    ),
  });
}

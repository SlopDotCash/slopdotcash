/**
 * Promotes a reviewed reward proposal to an approved, immutable payout-intent
 * manifest only after its public review deadline. The transition neither signs
 * nor broadcasts a Solana transaction.
 */

import {
  assertRewardAllocationManifest,
  exactUtcMilliseconds,
  feeForPrincipal,
  type RewardAllocationManifest,
} from "./rewards";

/** Finalizes reviewed decisions without changing any contributor row. */
export function finalizeRewardAllocation(
  untrustedProposal: unknown,
  approvedAt: string,
  now = Date.now(),
): RewardAllocationManifest {
  const proposal = assertRewardAllocationManifest(untrustedProposal);
  if (proposal.status !== "proposed") {
    throw new TypeError("Only a proposed reward allocation can be finalized");
  }
  if (proposal.review.lapsedAt) {
    throw new TypeError(
      "A lapsed reward allocation cannot be finalized; its review deadline has closed the cycle",
    );
  }
  if (proposal.allocations.length === 0) {
    throw new RangeError(
      "A zero-award cycle is already closed and has no allocation to approve",
    );
  }
  if (!Number.isFinite(now)) throw new TypeError("Current time must be finite");
  const approvalTime = exactUtcMilliseconds(approvedAt, "approvedAt");
  if (approvalTime > now + 5 * 60_000) {
    throw new RangeError("Reward allocation approval cannot be in the future");
  }
  if (approvalTime < Date.parse(proposal.review.endsAt)) {
    throw new RangeError("Reward allocation review period has not ended");
  }
  const unresolved = proposal.allocations.filter(
    (allocation) => allocation.state === "proposed",
  );
  if (unresolved.length > 0) {
    throw new TypeError(
      `Reward allocation has ${unresolved.length} unresolved proposed payment(s)`,
    );
  }
  // A cycle with no approved row pays nothing. It needs no allocation file: the
  // proposal already carries its held rows, and a plan cannot pay an empty set.
  if (
    !proposal.allocations.some((allocation) => allocation.state === "approved")
  ) {
    throw new RangeError(
      "A reward allocation with no approved payment is already closed and has no allocation to approve",
    );
  }
  const approvedMinor = proposal.allocations
    .reduce((total, allocation) => total + BigInt(allocation.approvedMinor), 0n)
    .toString();
  return assertRewardAllocationManifest({
    ...proposal,
    status: "approved",
    approvedAt,
    totals: {
      ...proposal.totals,
      approvedMinor,
      // The manifest fee sums the per-recipient fees settlement charges.
      feeMinor: proposal.allocations
        .reduce(
          (total, allocation) =>
            total +
            BigInt(
              feeForPrincipal(
                allocation.approvedMinor,
                proposal.feeBasisPoints,
              ),
            ),
          0n,
        )
        .toString(),
    },
  });
}

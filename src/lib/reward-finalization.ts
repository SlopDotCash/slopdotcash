/**
 * Promotes a reviewed reward proposal to an approved, immutable payout-intent
 * manifest only after its public review deadline. The transition neither signs
 * nor broadcasts a Solana transaction.
 */

import {
  assertRewardAllocationManifest,
  feeForPrincipal,
  type RewardAllocationManifest,
} from "./rewards";

function exactUtc(value: string, field: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`${field} must be an exact UTC timestamp`);
  }
  return Date.parse(value);
}

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
  if (proposal.allocations.length === 0) {
    throw new RangeError(
      "A zero-award cycle is already closed and has no allocation to approve",
    );
  }
  if (!Number.isFinite(now)) throw new TypeError("Current time must be finite");
  const approvalTime = exactUtc(approvedAt, "approvedAt");
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
      feeMinor: feeForPrincipal(approvedMinor, proposal.feeBasisPoints),
    },
  });
}

/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The 2% award fee rounds up, ceil(gross / 50), on both chains (PRD section 6,
 * owner decision of 25 October 2026; #1189). The live settlement paths charge
 * that rounded-up fee per recipient: the escrow proposal (ordinaryFee per
 * award) and the monthly execution snapshot (feeBase per award). The approved
 * reward-allocation manifest must publish the same total fee, so its
 * totals.feeMinor is the sum of the per-recipient rounded-up fees.
 *
 * feeForPrincipal floored the fee on the aggregate approved total instead:
 * a single approved award of 399 minor at 200bps published a 7-minor fee
 * while settlement deducted 8, and two approved awards of 2,000,001 minor
 * at 100bps published 40,000 while settlement deducted 40,002.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertCycleIndex } from "../src/lib/cycle-index";
import { ordinaryFee } from "../src/lib/payments/contracts";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  assertRewardAllocationManifest,
  feeForPrincipal,
  type RewardAllocationManifest,
} from "../src/lib/rewards";
import { archivedPaidCycleIndex } from "../tests/fixtures";

const proposalPath = resolve(
  import.meta.dir,
  "../tests/fixtures/history/cycles/eliza/2026-07/proposal.json",
);
const approvedAt = "2026-09-05T00:00:00.000Z";

/** Approves rows of the frozen 2026-07 eliza proposal at the given amounts. */
function approvedProposal(
  approvals: { login: string; approvedMinor: string }[],
): RewardAllocationManifest {
  const proposal = JSON.parse(
    readFileSync(proposalPath, "utf8"),
  ) as RewardAllocationManifest;
  const approvedLogins = new Set(approvals.map(({ login }) => login));
  for (const row of proposal.allocations) {
    if (approvedLogins.has(row.actor.login)) continue;
    // Finalization refuses "proposed" rows, so every other row resolves as
    // unclaimed with no wallet and no approved amount.
    row.state = "unclaimed";
    row.approvedMinor = "0";
    row.wallet = null;
  }
  for (const { login, approvedMinor } of approvals) {
    const row = proposal.allocations.find(
      (candidate) => candidate.actor.login === login,
    );
    if (!row) throw new Error(`no proposal row for ${login}`);
    row.state = "approved";
    row.approvedMinor = approvedMinor;
    row.adjustmentReason = "Owner approved a reduced award for this cycle.";
    row.wallet = {
      address: "11111111111111111111111111111111",
      chain: "solana",
      observedAt: "2026-08-01T00:00:00.000Z",
      sourceCommit: "b".repeat(40),
      sourceUrl: `https://github.com/${login}/${login}/blob/${"b".repeat(40)}/README.md`,
    };
  }
  proposal.totals.approvedMinor = proposal.allocations
    .reduce((sum, row) => sum + BigInt(row.approvedMinor), 0n)
    .toString();
  proposal.totals.feeMinor = proposal.allocations
    .reduce(
      (sum, row) =>
        sum +
        BigInt(feeForPrincipal(row.approvedMinor, proposal.feeBasisPoints)),
      0n,
    )
    .toString();
  return proposal;
}

test("feeForPrincipal rounds the 2% fee up like the settlement fee", () => {
  expect(feeForPrincipal("399", 200)).toBe(ordinaryFee(399n).toString());
  expect(feeForPrincipal("399", 200)).toBe("8");
  expect(feeForPrincipal("2000399", 100)).toBe("20004");
  expect(feeForPrincipal("0", 200)).toBe("0");
  expect(feeForPrincipal("1000000", 100)).toBe("10000");
});

test("a finalized single-recipient cycle publishes the rounded-up fee", () => {
  const finalized = finalizeRewardAllocation(
    approvedProposal([{ login: "lalalune", approvedMinor: "2000399" }]),
    approvedAt,
    Date.parse(approvedAt),
  );
  expect(finalized.totals.approvedMinor).toBe("2000399");
  // The fixture cycle charges 100bps: ceil(2,000,399 / 100) = 20,004,
  // while the floored fee was 20,003.
  expect(finalized.totals.feeMinor).toBe("20004");
});

test("a finalized two-recipient cycle sums the per-recipient fees", () => {
  const finalized = finalizeRewardAllocation(
    approvedProposal([
      { login: "lalalune", approvedMinor: "2000001" },
      { login: "0xSolace", approvedMinor: "2000001" },
    ]),
    approvedAt,
    Date.parse(approvedAt),
  );
  expect(finalized.totals.approvedMinor).toBe("4000002");
  // Each recipient pays ceil(2,000,001 / 100) = 20,001; the aggregate
  // ceiling of 40,001 would still understate what settlement deducts.
  expect(finalized.totals.feeMinor).toBe("40002");
});

test("the manifest validator rejects the floored fee", () => {
  const finalized = finalizeRewardAllocation(
    approvedProposal([{ login: "lalalune", approvedMinor: "2000399" }]),
    approvedAt,
    Date.parse(approvedAt),
  );
  expect(() =>
    assertRewardAllocationManifest({
      ...finalized,
      totals: { ...finalized.totals, feeMinor: "20003" },
    }),
  ).toThrow("allocation totals do not reconcile");
});

test("the cycle index accepts the rounded-up per-recipient fee", () => {
  const index = archivedPaidCycleIndex();
  const cycle = index.cycles[0];
  cycle.reward.suggestedMinor = "2000399";
  cycle.reward.approvedMinor = "2000399";
  cycle.reward.paidMinor = "2000399";
  cycle.reward.feeMinor = "20004";
  cycle.contributors[0].suggestedMinor = "2000399";
  cycle.contributors[0].approvedMinor = "2000399";
  cycle.contributors[0].paidMinor = "2000399";
  expect(() => assertCycleIndex(index)).not.toThrow();
});

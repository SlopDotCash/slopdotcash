/** Tests exact unsigned Solana USDC plans and tamper rejection. */

import { describe, expect, it } from "vitest";
import { assertRewardAllocationManifest } from "./rewards";
import {
  assertSettlementExecutionPlan,
  createSettlementExecutionPlan,
  SOLANA_MAINNET_USDC_MINT,
} from "./settlement-plan";

const RECIPIENT = "11111111111111111111111111111111";
const SOURCE = "Vote111111111111111111111111111111111111111";
const FEE = "Stake11111111111111111111111111111111111111";
const COMMIT = "a".repeat(40);

function approvedAllocation() {
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "approved",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: "2026-08-15T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-15T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "open-work-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_u1",
        actor: { id: "U_1", login: "contributor" },
        score: 100,
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        state: "approved",
        wallet: {
          address: RECIPIENT,
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/contributor/contributor/blob/${COMMIT}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    },
  });
}

describe("settlement execution plans", () => {
  it("includes exact contributor principal and the fee on top", () => {
    const allocation = approvedAllocation();
    const plan = createSettlementExecutionPlan({
      allocation,
      allocationSha256: "c".repeat(64),
      createdAt: "2026-08-15T00:01:00.000Z",
      feeRecipient: FEE,
      sourceOwner: SOURCE,
    });
    expect(plan.token.mint).toBe(SOLANA_MAINNET_USDC_MINT);
    expect(plan.transfers).toHaveLength(2);
    expect(plan.totals).toEqual({
      contributorMinor: "1000000",
      platformFeeMinor: "10000",
      totalMinor: "1010000",
    });
    expect(assertSettlementExecutionPlan(plan, allocation)).toEqual(plan);
  });

  it("rejects a plan paying the source and any post-generation tampering", () => {
    const allocation = approvedAllocation();
    expect(() =>
      createSettlementExecutionPlan({
        allocation,
        allocationSha256: "c".repeat(64),
        createdAt: "2026-08-15T00:01:00.000Z",
        feeRecipient: FEE,
        sourceOwner: RECIPIENT,
      }),
    ).toThrow(/source wallet/u);

    const plan = createSettlementExecutionPlan({
      allocation,
      allocationSha256: "c".repeat(64),
      createdAt: "2026-08-15T00:01:00.000Z",
      feeRecipient: FEE,
      sourceOwner: SOURCE,
    });
    plan.transfers[0].amountMinor = "1000001";
    expect(() => assertSettlementExecutionPlan(plan, allocation)).toThrow(
      /differs/u,
    );
  });
});

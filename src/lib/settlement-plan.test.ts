/** Tests exact unsigned Solana USDC plans and tamper rejection. */

import { describe, expect, it } from "vitest";
import { assertRewardAllocationManifest } from "./rewards";
import {
  assertSettlementExecutionPlan,
  createSettlementExecutionPlan,
  createSolanaPayTransferRequest,
  SOLANA_MAINNET_USDC_MINT,
} from "./settlement-plan";

const RECIPIENT = "11111111111111111111111111111111";
const SOURCE = "Vote111111111111111111111111111111111111111";
const OTHER_SOURCE = "SysvarRent111111111111111111111111111111111";
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
    scoringRuleVersion: "gitarmy-v1",
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
  function fundedAllocation(instrumentId: string) {
    const allocation = approvedAllocation();
    return assertRewardAllocationManifest({
      ...allocation,
      fundingBasis: {
        cycleId: allocation.cycleId,
        fundingState: "committed",
        committedMinor: allocation.capMinor,
        monthlyCapMinor: allocation.capMinor,
        instrumentId,
      },
    });
  }

  it("binds creation and readback to the frozen Squads vault, not any valid wallet", () => {
    const allocation = fundedAllocation(
      `squads-v4-vault:solana:${RECIPIENT}:0:${SOURCE}`,
    );
    const input = {
      allocation,
      allocationSha256: "c".repeat(64),
      createdAt: "2026-08-15T00:01:00.000Z",
      feeRecipient: FEE,
      sourceOwner: SOURCE,
    };
    const plan = createSettlementExecutionPlan(input);
    expect(assertSettlementExecutionPlan(plan, allocation)).toEqual(plan);
    expect(() =>
      createSettlementExecutionPlan({ ...input, sourceOwner: OTHER_SOURCE }),
    ).toThrow(/source owner must match the frozen funding vault/u);
    expect(() =>
      assertSettlementExecutionPlan(
        { ...plan, sourceOwner: OTHER_SOURCE },
        allocation,
      ),
    ).toThrow(/source owner must match the frozen funding vault/u);
  });

  it.each(["base", "ethereum"])(
    "does not invent a Solana source for a %s stream",
    (network) => {
      const allocation = fundedAllocation(
        `sablier-lockup-v4:${network}:0x${"a".repeat(40)}:1`,
      );
      expect(() =>
        createSettlementExecutionPlan({
          allocation,
          allocationSha256: "c".repeat(64),
          createdAt: "2026-08-15T00:01:00.000Z",
          feeRecipient: FEE,
          sourceOwner: SOURCE,
        }),
      ).toThrow(/requires a frozen Solana Squads funding instrument/u);
    },
  );

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

  it("creates exact Solana Pay requests without claiming payment", () => {
    const plan = createSettlementExecutionPlan({
      allocation: approvedAllocation(),
      allocationSha256: "c".repeat(64),
      createdAt: "2026-08-15T00:01:00.000Z",
      feeRecipient: FEE,
      sourceOwner: SOURCE,
    });
    const request = createSolanaPayTransferRequest(plan, plan.transfers[0]);
    expect(request).toContain(`solana:${RECIPIENT}?`);
    expect(request).toContain("amount=1.000000");
    expect(request).toContain(`spl-token=${SOLANA_MAINNET_USDC_MINT}`);
    expect(request).toContain("memo=contributor_pay_eliza_2026_07_u1");
    expect(plan.status).toBe("unsigned");
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

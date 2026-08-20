/** Proves allocation, external-share, and settlement financial invariants. */

import { describe, expect, it } from "vitest";
import {
  assertExternalContributionShareManifest,
  assertRewardAllocationManifest,
  assertRewardSettlementManifest,
  feeForPrincipal,
  incrementalFeeForPrincipal,
  type RewardAllocationManifest,
} from "./rewards";

const wallet = {
  address: "11111111111111111111111111111111",
  chain: "solana" as const,
  observedAt: "2026-08-10T00:00:00.000Z",
  sourceCommit: "f".repeat(40),
  sourceUrl: `https://github.com/contributor/contributor/blob/${"f".repeat(40)}/README.md`,
};

function allocationManifest() {
  return {
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-08",
    status: "approved",
    generatedAt: "2026-09-01T00:00:00.000Z",
    approvedAt: "2026-09-16T00:00:00.000Z",
    contributionWindow: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-09-15T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "outcome-compute-v1",
    sourceSnapshotSha256: "a".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_08_u1",
        actor: { id: "U_1", login: "contributor" },
        score: 100,
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        state: "approved",
        wallet: { ...wallet },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null as string | null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    },
  };
}

describe("reward manifests", () => {
  it("holds sub-$2 awards without discarding or redistributing them", () => {
    const manifest = allocationManifest() as ReturnType<
      typeof allocationManifest
    > & {
      carriedMinor: string;
      minimumTransferMinor: string;
    };
    manifest.status = "proposed";
    (manifest as unknown as { approvedAt: string | null }).approvedAt = null;
    manifest.carriedMinor = "0";
    manifest.minimumTransferMinor = "2000000";
    const allocation = manifest
      .allocations[0] as (typeof manifest.allocations)[number] & {
      accruedMinor: string;
    };
    allocation.accruedMinor = "1000000";
    allocation.approvedMinor = "0";
    allocation.state = "held-below-minimum";
    manifest.totals.approvedMinor = "0";
    manifest.totals.feeMinor = "0";

    expect(
      assertRewardAllocationManifest(manifest).allocations[0],
    ).toMatchObject({
      state: "held-below-minimum",
      accruedMinor: "1000000",
      approvedMinor: "0",
    });

    allocation.state = "approved";
    allocation.approvedMinor = "1000000";
    manifest.status = "approved";
    manifest.approvedAt = "2026-09-16T00:00:00.000Z";
    manifest.totals.approvedMinor = "1000000";
    manifest.totals.feeMinor = "10000";
    expect(() => assertRewardAllocationManifest(manifest)).toThrow(
      /below the \$2 minimum/u,
    );
  });

  it("validates an approved allocation and exact fee", () => {
    const manifest = assertRewardAllocationManifest(allocationManifest());
    expect(manifest.totals).toEqual({
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    });
    expect(feeForPrincipal("999", 300)).toBe("29");
    expect(incrementalFeeForPrincipal("99", "1", 100)).toBe("1");
    expect(incrementalFeeForPrincipal("0", "99", 100)).toBe("0");
    expect(() => feeForPrincipal("-1", 100)).toThrow(/principal/u);
    expect(() => feeForPrincipal("1", -1)).toThrow(/basis points/u);
    expect(() => feeForPrincipal("1", 10_001)).toThrow(/basis points/u);
    expect(() => incrementalFeeForPrincipal("1", "1", 0.5)).toThrow(
      /basis points/u,
    );
  });

  it("rejects cap overflow, silent reductions, and early approval", () => {
    const overflow = allocationManifest();
    overflow.allocations[0].suggestedMinor = "10000000001";
    overflow.allocations[0].approvedMinor = "10000000001";
    overflow.totals.suggestedMinor = "10000000001";
    overflow.totals.approvedMinor = "10000000001";
    overflow.totals.feeMinor = "100000000";
    expect(() => assertRewardAllocationManifest(overflow)).toThrow(/cap/u);

    const reduction = allocationManifest();
    reduction.allocations[0].approvedMinor = "500000";
    expect(() => assertRewardAllocationManifest(reduction)).toThrow(/reason/u);

    const early = allocationManifest();
    early.approvedAt = "2026-09-14T00:00:00.000Z";
    expect(() => assertRewardAllocationManifest(early)).toThrow(
      /before review/u,
    );
  });

  it("allows an owner to raise an individual award within the cycle cap", () => {
    const increased = allocationManifest();
    increased.allocations[0].suggestedMinor = "500000";
    increased.allocations[0].approvedMinor = "1500000";
    increased.allocations[0].adjustmentReason =
      "Project owner increased the award after reviewing the accepted result.";
    increased.totals.suggestedMinor = "500000";
    increased.totals.approvedMinor = "1500000";
    increased.totals.feeMinor = "15000";

    const manifest = assertRewardAllocationManifest(increased);
    expect(manifest.allocations[0].approvedMinor).toBe("1500000");
    expect(manifest.totals.feeMinor).toBe("15000");

    increased.allocations[0].adjustmentReason = null;
    expect(() => assertRewardAllocationManifest(increased)).toThrow(/reason/u);
  });

  it("requires an exact closed calendar-month contribution window", () => {
    const partial = allocationManifest();
    partial.contributionWindow.from = "2026-08-02T00:00:00.000Z";
    expect(() => assertRewardAllocationManifest(partial)).toThrow(
      /closed cycle/u,
    );

    const generatedEarly = allocationManifest();
    generatedEarly.generatedAt = "2026-08-31T23:59:59.999Z";
    expect(() => assertRewardAllocationManifest(generatedEarly)).toThrow(
      /closed cycle/u,
    );

    const impossibleDate = allocationManifest();
    impossibleDate.generatedAt = "2026-09-31T00:00:00.000Z";
    expect(() => assertRewardAllocationManifest(impossibleDate)).toThrow(
      /timestamp/u,
    );
  });

  it("requires independent approval for owner payments", () => {
    const manifest = allocationManifest();
    manifest.allocations[0].relatedParty = true;
    expect(() => assertRewardAllocationManifest(manifest)).toThrow(
      /platform approval/u,
    );
  });

  it("binds a wallet observation to the contributor's immutable profile README", () => {
    const forged = allocationManifest();
    forged.allocations[0].wallet.sourceUrl = `https://github.com/attacker/attacker/blob/${"f".repeat(40)}/README.md`;
    expect(() => assertRewardAllocationManifest(forged)).toThrow(
      /actor's immutable GitHub profile README/u,
    );

    const moving = allocationManifest();
    moving.allocations[0].wallet.sourceUrl =
      "https://github.com/contributor/contributor/blob/main/README.md";
    expect(() => assertRewardAllocationManifest(moving)).toThrow(
      /immutable GitHub profile README/u,
    );
  });

  it("binds a wallet claim issue to the exact contributor and body snapshot", () => {
    const manifest = allocationManifest() as unknown as {
      allocations: Array<{ wallet: unknown }>;
    };
    manifest.allocations[0].wallet = {
      address: wallet.address,
      chain: "solana",
      observedAt: wallet.observedAt,
      sourceActorId: "U_1",
      sourceBodySha256: "b".repeat(64),
      sourceIssueId: "I_wallet_claim",
      sourceIssueNumber: 42,
      sourceUpdatedAt: "2026-08-09T00:00:00.000Z",
      sourceUrl: "https://github.com/SlopDotCash/slopdotcash/issues/42",
    };
    expect(() => assertRewardAllocationManifest(manifest)).not.toThrow();

    const forged = structuredClone(manifest) as {
      allocations: Array<{ wallet: { sourceActorId: string } }>;
    };
    forged.allocations[0].wallet.sourceActorId = "U_attacker";
    expect(() => assertRewardAllocationManifest(forged)).toThrow(
      /does not match the contributor/u,
    );
  });

  it("accepts an immutable actor-bound Slop database wallet fallback", () => {
    const manifest = allocationManifest() as unknown as {
      allocations: Array<{ wallet: unknown }>;
    };
    manifest.allocations[0].wallet = {
      address: wallet.address,
      chain: "solana",
      observedAt: wallet.observedAt,
      sourceActorId: "U_1",
      sourceClaimId: "wc_fixture_01",
      sourceRecordSha256: "c".repeat(64),
      sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/wc_fixture_01",
    };
    expect(() => assertRewardAllocationManifest(manifest)).not.toThrow();

    const forged = structuredClone(manifest) as {
      allocations: Array<{ wallet: { sourceActorId: string } }>;
    };
    forged.allocations[0].wallet.sourceActorId = "U_attacker";
    expect(() => assertRewardAllocationManifest(forged)).toThrow(
      /does not match the contributor/u,
    );
  });

  it("represents Delta Star as a provisional percentage, never dollars", () => {
    const manifest = assertExternalContributionShareManifest({
      schemaVersion: "1",
      kind: "external-contribution-share",
      projectId: "delta-star",
      cycleId: "2026-08",
      status: "provisional",
      generatedAt: "2026-09-01T00:00:00.000Z",
      contributionWindow: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      },
      scoringRuleVersion: "gitarmy-v1",
      sourceSnapshotSha256: "b".repeat(64),
      entries: [
        {
          actor: { id: "U_1", login: "mathematician" },
          score: 10,
          sharePartsPerMillion: 1_000_000,
          evidenceEventIds: ["proof_1"],
        },
      ],
    });
    expect(manifest.entries[0].sharePartsPerMillion).toBe(1_000_000);
    expect(manifest).not.toHaveProperty("currency");
  });

  it("accepts explicit zero-award closes without inventing recipients", () => {
    const allocation = {
      ...allocationManifest(),
      status: "proposed",
      approvedAt: null,
      allocations: [],
      totals: {
        suggestedMinor: "0",
        approvedMinor: "0",
        feeMinor: "0",
      },
    };
    expect(assertRewardAllocationManifest(allocation).allocations).toEqual([]);

    const share = assertExternalContributionShareManifest({
      schemaVersion: "1",
      kind: "external-contribution-share",
      projectId: "delta-star",
      cycleId: "2026-08",
      status: "provisional",
      generatedAt: "2026-09-01T00:00:00.000Z",
      contributionWindow: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      },
      scoringRuleVersion: "gitarmy-v1",
      sourceSnapshotSha256: "b".repeat(64),
      entries: [],
    });
    expect(share.entries).toEqual([]);
  });

  it("rejects duplicate settlement and reconciles a finalized payment", () => {
    const allocation = assertRewardAllocationManifest(allocationManifest());
    const settlement = {
      schemaVersion: "1",
      kind: "reward-settlement",
      projectId: "eliza",
      cycleId: "2026-08",
      allocationSha256: "c".repeat(64),
      settledAt: "2026-09-16T01:00:00.000Z",
      currency: "USDC",
      chain: "solana",
      status: "paid",
      recipients: [
        {
          intentId: "pay_eliza_2026_08_u1",
          approvedMinor: "1000000",
          paidMinor: "1000000",
          state: "paid",
        },
      ],
      attempts: [
        {
          attemptId: "attempt_eliza_2026_08_1",
          intentIds: ["pay_eliza_2026_08_u1"],
          signature: "3".repeat(88),
          state: "finalized",
        },
      ],
      platformFee: {
        recipient: "11111111111111111111111111111111",
        dueMinor: "10000",
        paidMinor: "10000",
        signature: "5".repeat(88),
        state: "paid",
      },
      totals: {
        approvedMinor: "1000000",
        paidMinor: "1000000",
        feeMinor: "10000",
      },
    };
    expect(assertRewardSettlementManifest(settlement, allocation).status).toBe(
      "paid",
    );

    const proposed = allocationManifest() as RewardAllocationManifest;
    proposed.status = "proposed";
    proposed.approvedAt = null;
    expect(() =>
      assertRewardSettlementManifest(settlement, proposed as never),
    ).toThrow(/approved allocation/u);

    const predatesApproval = structuredClone(settlement);
    predatesApproval.settledAt = "2026-09-15T23:59:59.999Z";
    expect(() =>
      assertRewardSettlementManifest(predatesApproval, allocation),
    ).toThrow(/predates allocation approval/u);

    const reportedFee = structuredClone(settlement);
    reportedFee.status = "partially-paid";
    reportedFee.platformFee.state = "reported";
    reportedFee.platformFee.paidMinor = "0";
    expect(
      assertRewardSettlementManifest(reportedFee, allocation).platformFee,
    ).toMatchObject({ state: "reported", paidMinor: "0" });

    settlement.attempts.push({
      attemptId: "attempt_eliza_2026_08_2",
      intentIds: ["pay_eliza_2026_08_u1"],
      signature: "4".repeat(88),
      state: "finalized",
    });
    expect(() =>
      assertRewardSettlementManifest(settlement, allocation),
    ).toThrow(/finalized more than once/u);
  });
});

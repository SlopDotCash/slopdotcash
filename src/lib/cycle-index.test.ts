/**
 * Proves the browser financial boundary rejects contradictory lifecycle states,
 * unsafe artifact paths, duplicate cycles, and irreconcilable money totals.
 */

import { describe, expect, it } from "vitest";
import {
  assertCycleIndex,
  type CycleIndex,
  type CycleIndexEntry,
} from "./cycle-index";

const DIGEST = "a".repeat(64);

function entry(overrides: Partial<CycleIndexEntry> = {}): CycleIndexEntry {
  return {
    projectId: "eliza",
    cycleId: "2026-07",
    kind: "monthly-pool",
    state: "review",
    generatedAt: "2026-08-02T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    reviewEndsAt: "2026-08-16T00:00:00.000Z",
    approvedAt: null,
    settledAt: null,
    reward: {
      currency: "USDC",
      capMinor: "10000000000",
      suggestedMinor: "10000000000",
      approvedMinor: "0",
      paidMinor: "0",
      feeMinor: "0",
      sharePartsPerMillion: null,
    },
    contributors: [
      {
        actor: { id: "U_fixture", login: "finish-line" },
        score: 34,
        state: "proposed",
        suggestedMinor: "10000000000",
        approvedMinor: "0",
        paidMinor: "0",
        sharePartsPerMillion: null,
        wallet: {
          address: "11111111111111111111111111111111",
          chain: "solana",
          observedAt: "2026-08-02T00:00:00.000Z",
          sourceCommit: "b".repeat(40),
          sourceUrl: `https://github.com/finish-line/finish-line/blob/${"b".repeat(40)}/README.md`,
        },
      },
    ],
    files: {
      sourceSnapshot: {
        sha256: DIGEST,
        url: "/data/cycles/eliza/2026-07/source-snapshot.json",
      },
      proposal: {
        sha256: DIGEST,
        url: "/data/cycles/eliza/2026-07/proposal.json",
      },
      allocation: null,
      executionPlan: null,
      settlement: null,
    },
    ...overrides,
  };
}

function index(cycles: CycleIndexEntry[] = [entry()]): CycleIndex {
  return {
    schemaVersion: "1",
    generatedAt: "2026-08-02T00:00:00.000Z",
    cycles,
  };
}

describe("public cycle index", () => {
  function approvedCarry(
    shared: bigint,
    review: bigint | null = null,
  ): CycleIndex {
    const value = entry();
    const total = shared + (review ?? 0n);
    value.state = "payment-ready";
    value.approvedAt = "2026-08-16T00:00:00.000Z";
    value.files.allocation = {
      sha256: DIGEST,
      url: "/data/cycles/eliza/2026-07/allocation.json",
    };
    value.reward.capMinor = "1000000";
    value.reward.fundingBasis = {
      fundingState: "committed",
      committedMinor: "1000000",
      monthlyCapMinor: "10000000000",
    };
    value.reward.carriedMinor = "2000000";
    value.reward.suggestedMinor = total.toString();
    value.reward.approvedMinor = total.toString();
    value.reward.feeMinor = (total / 100n).toString();
    value.contributors[0].state = "approved";
    value.contributors[0].suggestedMinor = total.toString();
    value.contributors[0].approvedMinor = total.toString();
    if (review !== null) {
      value.reward.reviewBudgetCapMinor = "700000";
      value.reward.lines = {
        sharedPool: {
          suggestedMinor: shared.toString(),
          approvedMinor: shared.toString(),
          paidMinor: "0",
        },
        reviewBudget: {
          suggestedMinor: review.toString(),
          approvedMinor: review.toString(),
          paidMinor: "0",
        },
      };
      value.contributors[0].lines = structuredClone(value.reward.lines);
    }
    return { ...index([value]), generatedAt: "2026-08-20T00:00:00.000Z" };
  }

  it("accepts exactly cap plus carry and rejects one micro-unit more", () => {
    const exact = approvedCarry(3000000n);
    expect(() => assertCycleIndex(exact)).not.toThrow();
    expect(() => assertCycleIndex(approvedCarry(3000001n))).toThrow(
      /money totals do not reconcile/u,
    );
    exact.cycles[0].reward.capMinor = "0";
    exact.cycles[0].reward.fundingBasis = {
      fundingState: "pledged",
      committedMinor: "0",
      monthlyCapMinor: "10000000000",
    };
    exact.cycles[0].reward.carriedMinor = "3000000";
    expect(() => assertCycleIndex(exact)).not.toThrow();
  });

  it("applies carry only to the shared-pool cap and independently caps additive review", () => {
    expect(() =>
      assertCycleIndex(approvedCarry(3000000n, 700000n)),
    ).not.toThrow();
    expect(() => assertCycleIndex(approvedCarry(3000001n, 700000n))).toThrow(
      /money totals do not reconcile/u,
    );
    expect(() => assertCycleIndex(approvedCarry(1000000n, 700001n))).toThrow(
      /review budget exceeds its separate allocation cap/u,
    );
  });

  it("accepts a bounded public review state", () => {
    const value: unknown = index();
    expect(() => assertCycleIndex(value)).not.toThrow();
  });

  it("publishes additive review-budget money as reconciled line items", () => {
    const additive = entry();
    additive.reward.reviewBudgetCapMinor = "500000000";
    additive.reward.suggestedMinor = "10500000000";
    additive.reward.lines = {
      sharedPool: {
        suggestedMinor: "10000000000",
        approvedMinor: "0",
        paidMinor: "0",
      },
      reviewBudget: {
        suggestedMinor: "500000000",
        approvedMinor: "0",
        paidMinor: "0",
      },
    };
    additive.contributors[0].suggestedMinor = "10500000000";
    additive.contributors[0].lines = {
      sharedPool: {
        suggestedMinor: "10000000000",
        approvedMinor: "0",
        paidMinor: "0",
      },
      reviewBudget: {
        suggestedMinor: "500000000",
        approvedMinor: "0",
        paidMinor: "0",
      },
    };

    expect(() => assertCycleIndex(index([additive]))).not.toThrow();

    const missingContributorLines = structuredClone(additive);
    delete missingContributorLines.contributors[0].lines;
    expect(() => assertCycleIndex(index([missingContributorLines]))).toThrow(
      /line-item accounting/u,
    );

    additive.reward.lines.reviewBudget.suggestedMinor = "499999999";
    expect(() => assertCycleIndex(index([additive]))).toThrow(
      /reward lines do not reconcile/u,
    );
  });

  it("accepts an actor-bound Slop wallet claim issue", () => {
    const claimed = entry();
    claimed.contributors[0].wallet = {
      address: "11111111111111111111111111111111",
      chain: "solana",
      observedAt: "2026-08-02T00:00:00.000Z",
      sourceActorId: "U_fixture",
      sourceBodySha256: "b".repeat(64),
      sourceIssueId: "I_wallet_claim",
      sourceIssueNumber: 42,
      sourceUpdatedAt: "2026-08-01T00:00:00.000Z",
      sourceUrl: "https://github.com/SlopDotCash/slopdotcash/issues/42",
    };
    expect(() => assertCycleIndex(index([claimed]))).not.toThrow();
    claimed.contributors[0].wallet.sourceActorId = "U_attacker";
    expect(() => assertCycleIndex(index([claimed]))).toThrow(
      /does not match the contributor/u,
    );
  });

  it("accepts an immutable actor-bound database wallet fallback", () => {
    const claimed = entry();
    claimed.contributors[0].wallet = {
      address: "11111111111111111111111111111111",
      chain: "solana",
      observedAt: "2026-08-02T00:00:00.000Z",
      sourceActorId: "U_fixture",
      sourceClaimId: "wc_fixture_01",
      sourceRecordSha256: "c".repeat(64),
      sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/wc_fixture_01",
    };
    expect(() => assertCycleIndex(index([claimed]))).not.toThrow();
  });

  it("requires lifecycle files before claiming payment readiness or payment", () => {
    expect(() =>
      assertCycleIndex(index([entry({ state: "payment-ready" })])),
    ).toThrow("state does not match");
    expect(() => assertCycleIndex(index([entry({ state: "paid" })]))).toThrow(
      "state does not match",
    );
  });

  it("binds each lifecycle label to exact money and timestamp state", () => {
    const premature = entry({
      state: "payment-ready",
      approvedAt: null,
      files: {
        ...entry().files,
        allocation: {
          sha256: DIGEST,
          url: "/data/cycles/eliza/2026-07/allocation.json",
        },
      },
    });
    expect(() => assertCycleIndex(index([premature]))).toThrow(/state/u);

    const fakePaid = entry({
      state: "paid",
      approvedAt: "2026-08-16T00:00:00.000Z",
      settledAt: "2026-08-17T00:00:00.000Z",
      reward: {
        ...entry().reward,
        approvedMinor: "10000000",
        paidMinor: "1",
        feeMinor: "100000",
      },
      contributors: [
        {
          ...entry().contributors[0],
          state: "approved",
          approvedMinor: "10000000",
        },
      ],
      files: {
        ...entry().files,
        allocation: {
          sha256: DIGEST,
          url: "/data/cycles/eliza/2026-07/allocation.json",
        },
        executionPlan: {
          sha256: DIGEST,
          url: "/data/cycles/eliza/2026-07/execution-plan.json",
        },
        settlement: {
          sha256: DIGEST,
          url: "/data/cycles/eliza/2026-07/settlement.json",
        },
      },
    });
    expect(() => assertCycleIndex(index([fakePaid]))).toThrow(
      /reconcile|payment state|state/u,
    );
  });

  it("rejects traversal URLs, overpayment, and duplicate project cycles", () => {
    const traversal = entry();
    traversal.files.proposal.url =
      "/data/cycles/eliza/2026-07/../attacker/proposal.json";
    expect(() => assertCycleIndex(index([traversal]))).toThrow(
      "canonical cycle artifact",
    );

    const mislabeled = entry();
    mislabeled.files.proposal.url =
      "/data/cycles/eliza/2026-07/source-snapshot.json";
    expect(() => assertCycleIndex(index([mislabeled]))).toThrow(
      "canonical cycle artifact",
    );

    const overpaid = entry();
    overpaid.reward.approvedMinor = "1";
    overpaid.reward.paidMinor = "2";
    expect(() => assertCycleIndex(index([overpaid]))).toThrow(
      "money totals do not reconcile",
    );

    expect(() => assertCycleIndex(index([entry(), entry()]))).toThrow(
      "repeats a project cycle",
    );
  });

  it("keeps external prize shares out of the platform payment lifecycle", () => {
    const external = entry({
      projectId: "delta-star",
      kind: "external-prize-share",
      state: "external-provisional",
      reviewEndsAt: null,
      reward: {
        currency: null,
        capMinor: "0",
        suggestedMinor: "0",
        approvedMinor: "0",
        paidMinor: "0",
        feeMinor: "0",
        sharePartsPerMillion: 1_000_000,
      },
      contributors: [
        {
          actor: { id: "U_fixture", login: "finish-line" },
          score: 34,
          state: "external-share",
          suggestedMinor: "0",
          approvedMinor: "0",
          paidMinor: "0",
          sharePartsPerMillion: 1_000_000,
          wallet: null,
        },
      ],
      files: {
        sourceSnapshot: {
          sha256: DIGEST,
          url: "/data/cycles/delta-star/2026-07/source-snapshot.json",
        },
        proposal: {
          sha256: DIGEST,
          url: "/data/cycles/delta-star/2026-07/proposal.json",
        },
        allocation: null,
        executionPlan: null,
        settlement: null,
      },
    });

    expect(() => assertCycleIndex(index([external]))).not.toThrow();
    for (const monthlyFields of [
      { carriedMinor: "2000000" },
      { carriedMinor: "0" },
      {
        fundingBasis: {
          fundingState: "committed" as const,
          committedMinor: "2000000",
          monthlyCapMinor: "2000000",
        },
      },
      {
        fundingBasis: {
          fundingState: "pledged" as const,
          committedMinor: "0",
          monthlyCapMinor: "0",
        },
      },
      { reviewBudgetCapMinor: "2000000" },
    ]) {
      const invalid = structuredClone(external);
      Object.assign(invalid.reward, monthlyFields);
      expect(() => assertCycleIndex(index([invalid]))).toThrow(
        /reward differs from project policy/u,
      );
    }
    const dollarLarp = structuredClone(external);
    dollarLarp.reward.currency = "USDC";
    dollarLarp.reward.capMinor = "1";
    expect(() => assertCycleIndex(index([dollarLarp]))).toThrow(
      /project policy/u,
    );
    external.files.allocation = {
      sha256: DIGEST,
      url: "/data/cycles/delta-star/2026-07/allocation.json",
    };
    expect(() => assertCycleIndex(index([external]))).toThrow(
      "state does not match",
    );
  });

  it("represents a closed month with no accepted outcomes explicitly", () => {
    const empty = entry({
      state: "closed-no-awards",
      reward: {
        currency: "USDC",
        capMinor: "10000000000",
        suggestedMinor: "0",
        approvedMinor: "0",
        paidMinor: "0",
        feeMinor: "0",
        sharePartsPerMillion: null,
      },
      contributors: [],
    });
    expect(() => assertCycleIndex(index([empty]))).not.toThrow();

    empty.reward.paidMinor = "1";
    expect(() => assertCycleIndex(index([empty]))).toThrow(
      /money totals|state/u,
    );
  });

  it("preserves an owner's valid zero-dollar approval", () => {
    const zeroApproved = entry();
    zeroApproved.reward.approvedMinor = "0";
    zeroApproved.reward.feeMinor = "0";
    zeroApproved.contributors[0].approvedMinor = "0";
    expect(() => assertCycleIndex(index([zeroApproved]))).not.toThrow();
  });
});

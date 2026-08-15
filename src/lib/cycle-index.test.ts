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
  it("accepts a bounded public review state", () => {
    const value: unknown = index();
    expect(() => assertCycleIndex(value)).not.toThrow();
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
      sourceUrl: "https://github.com/elizaOS/slopdotcash/issues/42",
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

  it("rejects traversal URLs, overpayment, and duplicate project cycles", () => {
    const traversal = entry();
    traversal.files.proposal.url =
      "/data/cycles/eliza/2026-07/../attacker/proposal.json";
    expect(() => assertCycleIndex(index([traversal]))).toThrow(
      "outside its cycle",
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
});

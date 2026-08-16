/** Tests review-deadline and unresolved-decision gates before payout approval. */

import { describe, expect, it } from "vitest";
import { finalizeRewardAllocation } from "./reward-finalization";

const COMMIT = "a".repeat(40);

function reviewedProposal() {
  return {
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "proposed",
    generatedAt: "2026-08-02T00:00:00.000Z",
    approvedAt: null,
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-03T00:00:00.000Z",
      endsAt: "2026-08-17T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 300,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_0001_u_fixture",
        actor: { id: "U_fixture", login: "finish-line" },
        score: 10,
        suggestedMinor: "10000000000",
        approvedMinor: "9000000000",
        state: "approved",
        wallet: {
          address: "11111111111111111111111111111111",
          chain: "solana",
          observedAt: "2026-08-03T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/finish-line/finish-line/blob/${COMMIT}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason:
          "Excluded unsupported portions after maintainer review." as
            | string
            | null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "10000000000",
      approvedMinor: "9000000000",
      feeMinor: "270000000",
    },
  };
}

describe("reward allocation finalization", () => {
  it("locks reviewed rows and recomputes the exact platform fee", () => {
    const approved = finalizeRewardAllocation(
      reviewedProposal(),
      "2026-08-17T00:00:00.000Z",
      Date.parse("2026-08-17T00:01:00.000Z"),
    );
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe("2026-08-17T00:00:00.000Z");
    expect(approved.totals).toMatchObject({
      approvedMinor: "9000000000",
      feeMinor: "270000000",
    });
  });

  it("refuses early, future, or unresolved approval", () => {
    expect(() =>
      finalizeRewardAllocation(
        reviewedProposal(),
        "2026-08-16T23:59:59.999Z",
        Date.parse("2026-08-18T00:00:00.000Z"),
      ),
    ).toThrow(/has not ended/u);
    expect(() =>
      finalizeRewardAllocation(
        reviewedProposal(),
        "2026-08-18T00:00:00.000Z",
        Date.parse("2026-08-17T00:00:00.000Z"),
      ),
    ).toThrow(/future/u);
    const unresolved = reviewedProposal();
    unresolved.allocations[0].state = "proposed";
    unresolved.allocations[0].approvedMinor = "0";
    unresolved.allocations[0].adjustmentReason = null;
    unresolved.totals.approvedMinor = "0";
    unresolved.totals.feeMinor = "0";
    expect(() =>
      finalizeRewardAllocation(
        unresolved,
        "2026-08-17T00:00:00.000Z",
        Date.parse("2026-08-17T00:01:00.000Z"),
      ),
    ).toThrow(/unresolved/u);
  });

  it("forces a new review deadline when a wallet changes", () => {
    const staleReview = reviewedProposal();
    staleReview.allocations[0].wallet.observedAt = "2026-08-04T00:00:00.000Z";
    expect(() =>
      finalizeRewardAllocation(
        staleReview,
        "2026-08-17T00:00:00.000Z",
        Date.parse("2026-08-17T00:01:00.000Z"),
      ),
    ).toThrow(/newer than the declared material change/u);
  });

  it("keeps an explicit zero-award close out of the payment lifecycle", () => {
    const empty = reviewedProposal();
    empty.allocations = [];
    empty.totals = {
      suggestedMinor: "0",
      approvedMinor: "0",
      feeMinor: "0",
    };
    expect(() =>
      finalizeRewardAllocation(
        empty,
        "2026-08-17T00:00:00.000Z",
        Date.parse("2026-08-17T00:01:00.000Z"),
      ),
    ).toThrow(/zero-award/u);
  });
});

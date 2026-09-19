/** Tests the deadline that closes a proposal the creator never acted on. */

import { describe, expect, it } from "vitest";
import { lapseRewardAllocation } from "./review-lapse";

const COMMIT = "a".repeat(40);
const ENDS_AT = "2026-08-17T00:00:00.000Z";
const AFTER = Date.parse("2026-08-18T00:00:00.000Z");

function undecidedProposal() {
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
      endsAt: ENDS_AT,
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_0001_u_fixture",
        actor: { id: "U_fixture", login: "finish-line" },
        score: 10,
        suggestedMinor: "10000000000",
        approvedMinor: "0",
        state: "proposed",
        wallet: {
          address: "11111111111111111111111111111111",
          chain: "solana",
          observedAt: "2026-08-02T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/finish-line/finish-line/blob/${COMMIT}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null as string | null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "10000000000",
      approvedMinor: "0",
      feeMinor: "0",
    },
  };
}

describe("review lapse", () => {
  it("resolves undecided rows without approving or paying anything", () => {
    const lapsed = lapseRewardAllocation(undecidedProposal(), ENDS_AT, AFTER);
    expect(lapsed.review.lapsedAt).toBe(ENDS_AT);
    expect(lapsed.status).toBe("proposed");
    expect(lapsed.approvedAt).toBeNull();
    expect(lapsed.totals.approvedMinor).toBe("0");
    expect(lapsed.totals.feeMinor).toBe("0");
    const [row] = lapsed.allocations;
    expect(row.state).toBe("held");
    expect(row.hold).toEqual({ kind: "review-lapsed", lapsedAt: ENDS_AT });
    expect(row.approvedMinor).toBe("0");
    expect(row.adjustmentReason).toMatch(/no creator decision/u);
    // The frozen suggestion survives so the position can carry forward.
    expect(row.suggestedMinor).toBe("10000000000");
    expect(row.wallet).not.toBeNull();
  });

  it("refuses to lapse before the review window closes", () => {
    expect(() =>
      lapseRewardAllocation(
        undecidedProposal(),
        "2026-08-16T23:59:59.999Z",
        AFTER,
      ),
    ).toThrow(/has not ended/u);
  });

  it("refuses a future or inexact lapse time", () => {
    expect(() =>
      lapseRewardAllocation(
        undecidedProposal(),
        "2026-08-19T00:00:00.000Z",
        AFTER,
      ),
    ).toThrow(/cannot be in the future/u);
    expect(() =>
      lapseRewardAllocation(undecidedProposal(), "2026-08-18T00:00:00Z", AFTER),
    ).toThrow(/exact UTC timestamp/u);
  });

  it("leaves a cycle the creator acted on to ordinary finalization", () => {
    const acted = undecidedProposal();
    acted.allocations[0].state = "approved";
    acted.allocations[0].approvedMinor = "10000000000";
    acted.totals.approvedMinor = "10000000000";
    acted.totals.feeMinor = "100000000";
    expect(() => lapseRewardAllocation(acted, ENDS_AT, AFTER)).toThrow(
      /approved amounts cannot lapse/u,
    );
  });

  it("refuses to lapse twice or to lapse a decided cycle", () => {
    const once = lapseRewardAllocation(undecidedProposal(), ENDS_AT, AFTER);
    expect(() => lapseRewardAllocation(once, ENDS_AT, AFTER)).toThrow(
      /already lapsed/u,
    );
    const decided = undecidedProposal();
    decided.allocations[0].state = "excluded";
    decided.allocations[0].adjustmentReason =
      "Excluded after maintainer review of the evidence.";
    expect(() => lapseRewardAllocation(decided, ENDS_AT, AFTER)).toThrow(
      /no undecided rows/u,
    );
  });

  it("rejects a manifest that claims a lapse but keeps a proposed row", () => {
    const forged = undecidedProposal() as Record<string, unknown>;
    (forged.review as Record<string, unknown>).lapsedAt = ENDS_AT;
    expect(() => lapseRewardAllocation(forged, ENDS_AT, AFTER)).toThrow(
      /retains a proposed payment/u,
    );
  });
});

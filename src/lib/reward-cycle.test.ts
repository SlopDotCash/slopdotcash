/** Tests complete-window reward proposals and the separation of review states. */

import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../../tests/fixtures";
import {
  additiveReviewBudgetWeights,
  allocateReviewBudgetMinor,
  createRewardCycleProposal,
} from "./reward-cycle";
import type { WalletProof } from "./rewards";

const SOURCE_SHA = "a".repeat(64);
const PROFILE_COMMIT = "b".repeat(40);

function closedSnapshot() {
  const snapshot = snapshotFixture();
  snapshot.window.from = "2026-06-28T00:00:00.000Z";
  snapshot.window.to = "2026-08-02T00:00:00.000Z";
  snapshot.source.verificationWindow.from = snapshot.window.from;
  snapshot.source.verificationWindow.to = snapshot.window.to;
  return snapshot;
}

function wallet(): WalletProof {
  return {
    address: "11111111111111111111111111111111",
    chain: "solana",
    observedAt: "2026-08-02T00:00:00.000Z",
    sourceCommit: PROFILE_COMMIT,
    sourceUrl: `https://github.com/finish-line/finish-line/blob/${PROFILE_COMMIT}/README.md`,
  };
}

describe("reward cycle proposals", () => {
  it("allocates an additive review line with deterministic largest remainder", () => {
    expect(
      Object.fromEntries(
        allocateReviewBudgetMinor(10n, [
          { actorId: "actor-c", scoreThirds: 1 },
          { actorId: "actor-a", scoreThirds: 1 },
          { actorId: "actor-b", scoreThirds: 1 },
        ]),
      ),
    ).toEqual({ "actor-a": 4n, "actor-b": 3n, "actor-c": 3n });
    expect(
      Object.fromEntries(
        allocateReviewBudgetMinor(5n, [
          { actorId: "light", scoreThirds: 1 },
          { actorId: "deep", scoreThirds: 3 },
        ]),
      ),
    ).toEqual({ deep: 4n, light: 1n });
  });

  it("leaves the additive line unused without accepted review evidence", () => {
    expect(allocateReviewBudgetMinor(10n, [])).toEqual(new Map());
    expect(() =>
      allocateReviewBudgetMinor(10n, [
        { actorId: "duplicate", scoreThirds: 1 },
        { actorId: "duplicate", scoreThirds: 2 },
      ]),
    ).toThrow(/unique non-negative/u);
  });

  it("keeps the additive review line tier-only when trace weight differs", () => {
    const base = snapshotFixture().ledger[0];
    const events = [
      {
        ...base,
        id: "review-with-trace",
        actor: { ...base.actor, id: "actor-a", login: "actor-a" },
        category: "substantive-review" as const,
        points: 1,
        scoreThirds: 3,
        evidenceBonusBasisPoints: 1_500 as const,
      },
      {
        ...base,
        id: "review-without-trace",
        actor: { ...base.actor, id: "actor-b", login: "actor-b" },
        category: "substantive-review" as const,
        points: 1,
        scoreThirds: 3,
      },
    ];

    expect(
      Object.fromEntries(
        allocateReviewBudgetMinor(10n, additiveReviewBudgetWeights(events)),
      ),
    ).toEqual({ "actor-a": 5n, "actor-b": 5n });
  });

  it("proposes the exact Eliza pool without approving a payment", () => {
    const wallets = new Map([["U_fixture", wallet()]]);
    const proposal = createRewardCycleProposal({
      cycleId: "2026-07",
      generatedAt: "2026-08-02T00:00:00.000Z",
      projectId: "eliza",
      snapshot: closedSnapshot(),
      sourceSnapshotSha256: SOURCE_SHA,
      wallets,
    });
    expect(proposal.kind).toBe("reward-allocation");
    if (proposal.kind !== "reward-allocation") return;
    expect(proposal.status).toBe("proposed");
    expect(proposal.contributionWindow.from).toBe("2026-07-07T00:00:00.000Z");
    expect(proposal.totals).toEqual({
      approvedMinor: "0",
      feeMinor: "0",
      suggestedMinor: "10000000000",
    });
    expect(proposal.allocations[0]).toMatchObject({
      approvedMinor: "0",
      state: "proposed",
      suggestedMinor: "10000000000",
      wallet: wallet(),
    });
    expect(proposal.review.endsAt).toBe("2026-08-16T00:00:00.000Z");
  });

  it("keeps a backdated contributor visible but unclaimed without a wallet", () => {
    const proposal = createRewardCycleProposal({
      cycleId: "2026-07",
      generatedAt: "2026-08-02T00:00:00.000Z",
      projectId: "eliza",
      snapshot: closedSnapshot(),
      sourceSnapshotSha256: SOURCE_SHA,
    });
    if (proposal.kind !== "reward-allocation")
      throw new Error("wrong proposal");
    expect(proposal.allocations[0]).toMatchObject({
      approvedMinor: "0",
      state: "unclaimed",
      wallet: null,
    });
  });

  it("carries a prior below-minimum accrual for a cycle-inactive actor", () => {
    const base = {
      cycleId: "2026-07",
      generatedAt: "2026-08-02T00:00:00.000Z",
      projectId: "eliza" as const,
      snapshot: closedSnapshot(),
      sourceSnapshotSha256: SOURCE_SHA,
      priorAccruedMinor: new Map([["U_quiet", "1500000"]]),
    };
    expect(() => createRewardCycleProposal(base)).toThrow("has no prior login");

    const proposal = createRewardCycleProposal({
      ...base,
      priorActorLogins: new Map([["U_quiet", "quiet-contributor"]]),
      wallets: new Map([
        [
          "U_quiet",
          {
            ...wallet(),
            sourceUrl: `https://github.com/quiet-contributor/quiet-contributor/blob/${PROFILE_COMMIT}/README.md`,
          },
        ],
      ]),
    });
    if (proposal.kind !== "reward-allocation")
      throw new Error("wrong proposal");
    expect(proposal.carriedMinor).toBe("1500000");
    const carried = proposal.allocations.find(
      (allocation) => allocation.actor.id === "U_quiet",
    );
    expect(carried).toMatchObject({
      actor: { id: "U_quiet", login: "quiet-contributor" },
      score: 0,
      accruedMinor: "1500000",
      approvedMinor: "0",
      state: "held-below-minimum",
      evidenceEventIds: [],
    });
  });

  it("publishes Delta Star only as a provisional external-prize share", () => {
    const proposal = createRewardCycleProposal({
      cycleId: "2026-07",
      generatedAt: "2026-08-02T00:00:00.000Z",
      projectId: "delta-star",
      snapshot: closedSnapshot(),
      sourceSnapshotSha256: SOURCE_SHA,
    });
    expect(proposal).toMatchObject({
      kind: "external-contribution-share",
      status: "provisional",
      platformSharePartsPerMillion: 100_000,
      entries: [{ sharePartsPerMillion: 900_000 }],
    });
    expect(proposal).not.toHaveProperty("currency");
  });

  it("refuses a live or partial cycle and a digest-shaped lie", () => {
    expect(() =>
      createRewardCycleProposal({
        cycleId: "2026-07",
        generatedAt: "2026-07-30T00:00:00.000Z",
        projectId: "eliza",
        snapshot: snapshotFixture(),
        sourceSnapshotSha256: SOURCE_SHA,
      }),
    ).toThrow(/complete closed-window/u);

    expect(() =>
      createRewardCycleProposal({
        cycleId: "2026-07",
        generatedAt: "2026-08-02T00:00:00.000Z",
        projectId: "eliza",
        snapshot: closedSnapshot(),
        sourceSnapshotSha256: "not-a-digest",
      }),
    ).toThrow(/SHA-256/u);
  });

  it("fails closed when evidence verification was suppressed", () => {
    const snapshot = closedSnapshot();
    snapshot.source.evidenceVerification = {
      ...snapshot.source.evidenceVerification,
      status: "suppressed-limit",
      sourceCount: snapshot.source.evidenceVerification.maxSources + 1,
    };

    expect(() =>
      createRewardCycleProposal({
        cycleId: "2026-07",
        generatedAt: "2026-08-02T00:00:00.000Z",
        projectId: "eliza",
        snapshot,
        sourceSnapshotSha256: SOURCE_SHA,
      }),
    ).toThrow(/incomplete verification coverage/u);
  });

  it("closes an empty month with a zero-dollar auditable proposal", () => {
    const snapshot = closedSnapshot();
    snapshot.ledger = [];
    snapshot.leaders = [];
    const proposal = createRewardCycleProposal({
      cycleId: "2026-07",
      generatedAt: "2026-08-02T00:00:00.000Z",
      projectId: "eliza",
      snapshot,
      sourceSnapshotSha256: SOURCE_SHA,
    });

    expect(proposal).toMatchObject({
      kind: "reward-allocation",
      allocations: [],
      totals: { approvedMinor: "0", feeMinor: "0", suggestedMinor: "0" },
    });
  });
});

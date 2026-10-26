import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

// The committed registry snapshot is empty and the frozen fixture registry
// prices every monthly pool at 100 basis points, so no fixture project can
// exercise the escrow price. Mock the project lookup itself: the function
// under test only reads the project's monthly-pool reward through it.
const eliza200 = {
  id: "eliza",
  reward: {
    kind: "monthly-pool",
    chain: "solana",
    currency: "USDC",
    cycle: "calendar-month-utc",
    monthlyCapMinor: "1000000000",
    monthlyCapDisplay: "$1,000,000.00",
    committedMinor: "0",
    paymentMode: "disabled",
    feeBasisPoints: 200,
    unusedFunds: "rollover-without-cap-increase",
    fundingState: "pledged",
    rewardStartAt: "2026-07-07T00:00:00.000Z",
  },
};

mock.module(fileURLToPath(new URL("./projects.mjs", import.meta.url)), () => ({
  // Current code calls it findHistoricalProject; the fork base calls it
  // findProject. Provide both so the test runs on either revision.
  findHistoricalProject: (id: string) => (id === "eliza" ? eliza200 : null),
  findProject: (id: string) => (id === "eliza" ? eliza200 : null),
}));

const { assertRewardAllocationManifest, feeForPrincipal } = await import("./rewards");

function fee200Manifest() {
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
      lastMaterialChangeAt: "2026-08-02T00:00:00.000Z",
      endsAt: "2026-08-16T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "1000000000",
    feeBasisPoints: 200,
    scoringRuleVersion: "test",
    sourceSnapshotSha256: "0".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_1_alice",
        actor: { id: "actor-alice", login: "alice" },
        score: 10,
        suggestedMinor: "5000000",
        approvedMinor: "0",
        state: "proposed",
        wallet: {
          address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: "a".repeat(40),
          sourceUrl:
            "https://github.com/alice/alice/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/README.md",
        },
        evidenceEventIds: [],
        adjustmentReason: null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "5000000",
      approvedMinor: "0",
      feeMinor: "0",
    },
  };
}

test("a 200-basis-point allocation keeps its fee through validation", () => {
  const validated = assertRewardAllocationManifest(fee200Manifest());
  expect(validated.feeBasisPoints).toBe(200);
  // The validated manifest must validate again: finalization re-validates
  // the proposal, so a rewritten fee breaks the propose-to-finalize path.
  expect(() => assertRewardAllocationManifest(validated)).not.toThrow();
});

test("feeForPrincipal rounds the fee up, matching PRD section 6", () => {
  // PRD section 6: ceil(gross / 50) at 200 basis points. A one-base-unit
  // award pays one unit in fees and zero to the contributor.
  expect(feeForPrincipal("0", 200)).toBe("0");
  expect(feeForPrincipal("1", 200)).toBe("1");
  expect(feeForPrincipal("49", 200)).toBe("1");
  expect(feeForPrincipal("50", 200)).toBe("1");
  expect(feeForPrincipal("51", 200)).toBe("2");
  expect(feeForPrincipal("100", 200)).toBe("2");
  expect(feeForPrincipal("349", 200)).toBe("7");
  expect(feeForPrincipal("51", 100)).toBe("1");
});

test("feeForPrincipal never lowers the fee when an amount is split", () => {
  const whole = BigInt(feeForPrincipal("100", 200));
  let split = 0n;
  for (let i = 0; i < 100; i += 1) {
    split += BigInt(feeForPrincipal("1", 200));
  }
  expect(split).toBeGreaterThanOrEqual(whole);
});

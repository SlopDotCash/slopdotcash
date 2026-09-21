import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../../tests/fixtures";
import type { CycleIndex, CycleIndexEntry } from "./cycle-index";
import { payoutPointAwards } from "./payout-points";
import {
  appendPointAwards,
  applyPointsSnapshot,
  emptyPointsJournal,
  pointMembers,
} from "./points";

function cycle(amount = "10000000"): CycleIndexEntry {
  const ref = (name: string) => ({
    sha256: "a".repeat(64),
    url: `/data/cycles/eliza/2026-07/${name}.json`,
  });
  return {
    projectId: "eliza",
    cycleId: "2026-07",
    kind: "monthly-pool",
    state: "paid",
    generatedAt: "2026-08-17T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    reviewEndsAt: "2026-08-16T00:00:00.000Z",
    approvedAt: "2026-08-16T00:00:00.000Z",
    settledAt: "2026-08-17T00:00:00.000Z",
    reward: {
      currency: "USDC",
      capMinor: amount,
      suggestedMinor: amount,
      approvedMinor: amount,
      paidMinor: amount,
      feeMinor: (BigInt(amount) / 100n).toString(),
      sharePartsPerMillion: null,
    },
    contributors: [
      {
        actor: { id: "U_fixture", login: "finish-line" },
        score: 34,
        state: "paid",
        suggestedMinor: amount,
        approvedMinor: amount,
        paidMinor: amount,
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
      sourceSnapshot: ref("source-snapshot"),
      proposal: ref("proposal"),
      allocation: ref("allocation"),
      executionPlan: ref("execution-plan"),
      settlement: ref("settlement"),
    },
  };
}
const index = (c: CycleIndexEntry): CycleIndex => ({
  schemaVersion: "1",
  generatedAt: "2026-09-21T12:00:00.000Z",
  cycles: [c],
});
describe("finalized payout points", () => {
  it("awards once per cycle, ignores payment size, preserves money, and survives rolling score refreshes", () => {
    const c = cycle(),
      original = JSON.stringify(c);
    const awards = payoutPointAwards(index(c));
    expect(awards).toHaveLength(1);
    expect(awards[0].amount).toBe(25);
    expect(awards[0].occurredAt).toBe(c.settledAt);
    expect(payoutPointAwards(index(cycle("20000000")))[0].amount).toBe(25);
    const now = "2026-09-21T12:00:00.000Z";
    let journal = appendPointAwards(
      emptyPointsJournal(now),
      awards,
      "a".repeat(64),
      "verified-payout-v1",
      now,
    );
    journal = appendPointAwards(
      journal,
      awards,
      "b".repeat(64),
      "verified-payout-v1",
      now,
    );
    expect(journal.revisions).toHaveLength(1);
    expect(pointMembers(journal)[0].badges).toEqual(["Verified payout"]);
    const snapshot = snapshotFixture();
    snapshot.window.from = "2026-08-01T00:00:00.000Z";
    snapshot.window.to = now;
    snapshot.ledger = [];
    expect(
      pointMembers(
        applyPointsSnapshot(journal, snapshot, "c".repeat(64), now),
      )[0].total,
    ).toBe(25);
    expect(JSON.stringify(c)).toBe(original);
  });
  it("does not award proposed, approved, partial, or forged paid state", () => {
    const c = cycle();
    c.state = "payment-ready";
    c.settledAt = null;
    c.reward.paidMinor = "0";
    c.contributors[0].state = "approved";
    c.contributors[0].paidMinor = "0";
    c.files.executionPlan = null;
    c.files.settlement = null;
    expect(payoutPointAwards(index(c))).toEqual([]);
    c.state = "paid";
    expect(() => payoutPointAwards(index(c))).toThrow();
    const partial = cycle();
    partial.contributors[0].paidMinor = "1";
    partial.reward.paidMinor = "1";
    expect(() => payoutPointAwards(index(partial))).toThrow();
  });
});

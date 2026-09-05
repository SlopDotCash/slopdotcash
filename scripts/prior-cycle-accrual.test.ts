import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import { snapshotFixture } from "../tests/fixtures";
import { loadPriorCycleAccrual, previousCycleId } from "./prior-cycle-accrual";

function julyProposal() {
  const snapshot = snapshotFixture();
  snapshot.window.from = "2026-06-28T00:00:00.000Z";
  snapshot.window.to = "2026-08-02T00:00:00.000Z";
  snapshot.source.verificationWindow.from = snapshot.window.from;
  snapshot.source.verificationWindow.to = snapshot.window.to;
  const proposal = createRewardCycleProposal({
    cycleId: "2026-07",
    generatedAt: "2026-08-02T00:00:00.000Z",
    projectId: "eliza",
    fundingBasis: {
      fundingState: "committed",
      committedMinor: "10000000000",
      monthlyCapMinor: "10000000000",
    },
    snapshot,
    sourceSnapshotSha256: "a".repeat(64),
  });
  if (proposal.kind !== "reward-allocation") throw new Error("wrong fixture");
  return proposal;
}

describe("prior cycle accrual", () => {
  it("never carries the immutable historical trial suggestion", async () => {
    const cyclesRoot = join(process.cwd(), "cycles");
    const proposalPath = join(cyclesRoot, "eliza", "2026-07", "proposal.json");
    const before = await readFile(proposalPath);
    const result = await loadPriorCycleAccrual({
      asOf: "2026-09-05T00:00:00.000Z",
      cycleId: "2026-08",
      cyclesRoot,
      projectId: "eliza",
    });
    expect([...result.accruedMinor]).toEqual([]);
    expect(await readFile(proposalPath)).toEqual(before);
  });
  it("closes an unfunded score record, then funds a new cycle without creating retroactive carry", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-unfunded-transition-"));
    const directory = join(root, "eliza", "2026-07");
    await mkdir(directory, { recursive: true });
    const july = julyProposal();
    const snapshot = snapshotFixture();
    snapshot.window.from = "2026-06-28T00:00:00.000Z";
    snapshot.window.to = "2026-08-02T00:00:00.000Z";
    snapshot.source.verificationWindow = { ...snapshot.window };
    const zero = createRewardCycleProposal({
      cycleId: "2026-07",
      generatedAt: july.generatedAt,
      projectId: "eliza",
      snapshot,
      sourceSnapshotSha256: july.sourceSnapshotSha256,
    });
    if (zero.kind !== "reward-allocation") throw new Error("wrong fixture");
    expect(zero.totals.suggestedMinor).toBe("0");
    expect(zero.allocations[0].score).toBe(july.allocations[0].score);
    expect(zero.allocations[0].evidenceEventIds).toEqual(
      july.allocations[0].evidenceEventIds,
    );
    const original = JSON.stringify(zero);
    await writeFile(join(directory, "proposal.json"), original);
    const carry = await loadPriorCycleAccrual({
      asOf: "2026-08-03T00:00:00.000Z",
      cycleId: "2026-08",
      cyclesRoot: root,
      projectId: "eliza",
    });
    expect([...carry.accruedMinor]).toEqual([]);
    snapshot.window = {
      days: 35,
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    };
    snapshot.source.verificationWindow = { ...snapshot.window };
    snapshot.ledger = snapshot.ledger.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.replace("2026-07", "2026-08"),
    }));
    const august = createRewardCycleProposal({
      cycleId: "2026-08",
      generatedAt: "2026-09-02T00:00:00.000Z",
      projectId: "eliza",
      snapshot,
      sourceSnapshotSha256: "b".repeat(64),
      fundingBasis: {
        fundingState: "committed",
        committedMinor: "5000000",
        monthlyCapMinor: "10000000000",
      },
      priorAccruedMinor: carry.accruedMinor,
    });
    expect(august).toMatchObject({
      carriedMinor: "0",
      capMinor: "5000000",
      totals: { suggestedMinor: "5000000" },
    });
    expect(await readFile(join(directory, "proposal.json"), "utf8")).toBe(
      original,
    );
  });

  it("handles calendar-year boundaries", () => {
    expect(previousCycleId("2026-01")).toBe("2025-12");
  });

  it("loads reviewed unclaimed money and ignores paid or held intents", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-prior-accrual-"));
    const directory = join(root, "eliza", "2026-07");
    await mkdir(directory, { recursive: true });
    const proposal = julyProposal();
    proposal.allocations[0].state = "unclaimed";
    await writeFile(
      join(directory, "proposal.json"),
      `${JSON.stringify(proposal)}\n`,
    );

    const result = await loadPriorCycleAccrual({
      asOf: "2026-09-02T00:00:00.000Z",
      cycleId: "2026-08",
      cyclesRoot: root,
      projectId: "eliza",
    });
    expect(result.accruedMinor.get("U_fixture")).toBe("10000000000");
    expect(result.actorLogins.get("U_fixture")).toBe("finish-line");

    proposal.allocations[0].state = "held";
    proposal.allocations[0].adjustmentReason =
      "Maintainer placed this intent on a manual hold.";
    await writeFile(
      join(directory, "allocation.json"),
      `${JSON.stringify({
        ...proposal,
        status: "approved",
        approvedAt: "2026-08-17T00:00:00.000Z",
      })}\n`,
    );
    const held = await loadPriorCycleAccrual({
      asOf: "2026-09-02T00:00:00.000Z",
      cycleId: "2026-08",
      cyclesRoot: root,
      projectId: "eliza",
    });
    expect([...held.accruedMinor]).toEqual([]);
  });

  it("refuses an unresolved prior review", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-prior-accrual-"));
    const directory = join(root, "eliza", "2026-07");
    await mkdir(directory, { recursive: true });
    const proposal = julyProposal();
    proposal.allocations[0].state = "proposed";
    proposal.allocations[0].wallet = {
      address: "11111111111111111111111111111111",
      chain: "solana",
      observedAt: "2026-08-02T00:00:00.000Z",
      sourceCommit: "b".repeat(40),
      sourceUrl: `https://github.com/finish-line/finish-line/blob/${"b".repeat(40)}/README.md`,
    };
    await writeFile(
      join(directory, "proposal.json"),
      `${JSON.stringify(proposal)}\n`,
    );
    await expect(
      loadPriorCycleAccrual({
        asOf: "2026-09-02T00:00:00.000Z",
        cycleId: "2026-08",
        cyclesRoot: root,
        projectId: "eliza",
      }),
    ).rejects.toThrow("has unresolved proposals");
  });

  it("refuses a partial prior cycle directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-prior-accrual-"));
    await mkdir(join(root, "eliza", "2026-07"), { recursive: true });
    await expect(
      loadPriorCycleAccrual({
        asOf: "2026-09-02T00:00:00.000Z",
        cycleId: "2026-08",
        cyclesRoot: root,
        projectId: "eliza",
      }),
    ).rejects.toThrow("is partial");
  });
});

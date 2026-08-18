import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
    snapshot,
    sourceSnapshotSha256: "a".repeat(64),
  });
  if (proposal.kind !== "reward-allocation") throw new Error("wrong fixture");
  return proposal;
}

describe("prior cycle accrual", () => {
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

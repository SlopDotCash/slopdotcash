import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { snapshotFixture } from "../tests/fixtures";
import {
  parsePrepareRewardCycleArguments,
  prepareRewardCycle,
} from "./prepare-reward-cycle";

describe("prepare reward cycle accrual", () => {
  it("wires prior balances and carried-only wallet observations into the proposal", async () => {
    const snapshot = snapshotFixture();
    snapshot.window.from = "2026-06-28T00:00:00.000Z";
    snapshot.window.to = "2026-08-02T00:00:00.000Z";
    snapshot.source.fetchedAt = snapshot.generatedAt;
    snapshot.source.cutoffAt = snapshot.window.to;
    snapshot.source.verificationWindow.from = snapshot.window.from;
    snapshot.source.verificationWindow.to = snapshot.window.to;
    const root = await mkdtemp(join(tmpdir(), "slop-prepare-cycle-"));
    const snapshotPath = join(root, "snapshot.json");
    await writeFile(snapshotPath, JSON.stringify(snapshot));
    const arguments_ = parsePrepareRewardCycleArguments([
      "--project",
      "eliza",
      "--cycle",
      "2026-07",
      "--snapshot",
      snapshotPath,
    ]);
    const observed: string[] = [];
    const write = vi.fn(async () => undefined);
    const proposal = await prepareRewardCycle(arguments_, {
      generatedAt: snapshot.generatedAt,
      loadPriorAccrual: async () => ({
        actorLogins: new Map([["U_quiet", "quiet-contributor"]]),
        accruedMinor: new Map([["U_quiet", "1500000"]]),
      }),
      observeWallet: async (actorId) => {
        observed.push(actorId);
        return null;
      },
      write,
      writeSnapshot: write,
    });

    expect(observed.sort()).toEqual(["U_fixture", "U_quiet"]);
    expect(proposal.kind).toBe("reward-allocation");
    if (proposal.kind !== "reward-allocation") return;
    expect(proposal.carriedMinor).toBe("1500000");
    expect(proposal.capMinor).toBe("0");
    expect(proposal.totals.suggestedMinor).toBe("1500000");
    expect(write).toHaveBeenCalledWith(
      arguments_.snapshotArchivePath,
      Buffer.from(JSON.stringify(snapshot)),
    );
    expect(write).toHaveBeenCalledWith(arguments_.outputPath, proposal);
    expect(proposal.allocations).toContainEqual(
      expect.objectContaining({
        actor: { id: "U_quiet", login: "quiet-contributor" },
        accruedMinor: "1500000",
        state: "unclaimed",
      }),
    );
    expect(arguments_.snapshotPath).toBe(resolve(snapshotPath));
  });
});

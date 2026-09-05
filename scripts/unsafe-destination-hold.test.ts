import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
  type SlopDatabaseWalletProof,
  type UnsafeDestinationReport,
  unsafeDestinationReportMessage,
} from "../src/lib/rewards";
import { createSettlementExecutionPlan } from "../src/lib/settlement-plan";
import { snapshotFixture } from "../tests/fixtures";
import {
  parsePrepareRewardCycleArguments,
  prepareRewardCycle,
} from "./prepare-reward-cycle";
import { loadPriorCycleAccrual } from "./prior-cycle-accrual";
import {
  applyUnsafeDestinationHold,
  verifyUnsafeDestinationReport,
} from "./unsafe-destination-hold";

const GENERATED = "2026-08-02T00:00:00.000Z";
const REPORTED = "2026-08-03T00:00:00.000Z";
const VERIFIED = "2026-08-03T01:00:00.000Z";
const UNSAFE = "11111111111111111111111111111111";
const SAFE = "Vote111111111111111111111111111111111111111";

function wallet(
  actor = "U_fixture",
  claim = "claim_original",
  address = UNSAFE,
  observedAt = GENERATED,
): SlopDatabaseWalletProof {
  return {
    address,
    chain: "solana",
    observedAt,
    sourceActorId: actor,
    sourceClaimId: claim,
    sourceRecordSha256: "b".repeat(64),
    sourceUrl: `https://api.slop.cash/api/v1/wallet-claims/${claim}`,
  };
}

function proposal(): RewardAllocationManifest {
  const snapshot = snapshotFixture();
  snapshot.window.from = "2026-06-28T00:00:00.000Z";
  snapshot.window.to = GENERATED;
  snapshot.source.verificationWindow = {
    ...snapshot.source.verificationWindow,
    from: snapshot.window.from,
    to: snapshot.window.to,
  };
  const result = createRewardCycleProposal({
    cycleId: "2026-07",
    generatedAt: GENERATED,
    projectId: "eliza",
    snapshot,
    sourceSnapshotSha256: "a".repeat(64),
    wallets: new Map([["U_fixture", wallet()]]),
  });
  if (result.kind !== "reward-allocation") throw new Error("wrong fixture");
  const row = result.allocations[0];
  row.suggestedMinor = row.accruedMinor = row.approvedMinor = "5000000000";
  row.state = "approved";
  result.allocations.push({
    ...structuredClone(row),
    intentId: "pay_eliza_2026_07_other",
    actor: { id: "U_other", login: "other" },
    wallet: wallet("U_other", "claim_other", SAFE),
  });
  result.totals.approvedMinor = "10000000000";
  result.totals.feeMinor = "100000000";
  return assertRewardAllocationManifest(result);
}

function report(): UnsafeDestinationReport {
  return {
    kind: "unsafe-destination",
    projectId: "eliza",
    cycleId: "2026-07",
    intentId: proposal().allocations[0].intentId,
    reportedAt: REPORTED,
    verifiedAt: VERIFIED,
    wallet: wallet(),
    sourceRepository: "finish-line/reports",
    sourceCommit: "c".repeat(40),
  };
}

function signedCommit(evidence = report()) {
  return {
    oid: evidence.sourceCommit,
    message: `${unsafeDestinationReportMessage(evidence)}\n`,
    signature: {
      isValid: true,
      state: "VALID",
      signer: { id: "U_fixture", databaseId: 42 },
    },
  };
}

async function heldProposal() {
  return applyUnsafeDestinationHold({
    proposal: proposal(),
    report: report(),
    reason:
      "Contributor authenticated a report that this destination is compromised.",
    now: VERIFIED,
    readCommit: async () => signedCommit(),
  });
}

describe("authenticated unsafe destination holds", () => {
  it("preserves the original wallet, other rows, and review clock while excluding the held payment", async () => {
    const before = proposal();
    const held = await heldProposal();
    expect(before.allocations[0].state).toBe("approved");
    expect(held.allocations[0]).toMatchObject({
      state: "held",
      approvedMinor: "0",
      wallet: before.allocations[0].wallet,
      hold: { kind: "unsafe-destination" },
    });
    expect(held.allocations[1]).toEqual(before.allocations[1]);
    expect(held.review).toEqual(before.review);
    const approved = finalizeRewardAllocation(
      held,
      held.review.endsAt,
      Date.parse(held.review.endsAt),
    );
    expect(approved.allocations).toEqual(held.allocations);
    const plan = createSettlementExecutionPlan({
      allocation: approved,
      allocationSha256: "d".repeat(64),
      createdAt: held.review.endsAt,
      sourceOwner: "Stake11111111111111111111111111111111111111",
      feeRecipient: "SysvarRent111111111111111111111111111111111",
    });
    expect(
      plan.transfers.some((transfer) => transfer.recipientOwner === UNSAFE),
    ).toBe(false);
    expect(
      plan.transfers.filter((transfer) => transfer.kind === "contributor"),
    ).toHaveLength(1);
  });

  it("rejects unsigned, wrong-signer, wrong-commit, and changed-payload evidence", async () => {
    const cases = [
      { ...signedCommit(), signature: null },
      {
        ...signedCommit(),
        signature: { ...signedCommit().signature, isValid: false },
      },
      {
        ...signedCommit(),
        signature: {
          ...signedCommit().signature,
          signer: { id: "U_attacker", databaseId: 99 },
        },
      },
      { ...signedCommit(), oid: "d".repeat(40) },
      {
        ...signedCommit(),
        message: unsafeDestinationReportMessage({
          ...report(),
          wallet: wallet("U_fixture", "claim_attacker", SAFE),
        }),
      },
    ];
    for (const commit of cases)
      await expect(
        verifyUnsafeDestinationReport(report(), async () => commit),
      ).rejects.toThrow();
  });

  it("rejects a foreign actor, substituted original claim, late verification, and missing reason", async () => {
    for (const evidence of [
      { ...report(), wallet: wallet("U_other") },
      { ...report(), wallet: wallet("U_fixture", "claim_substituted") },
    ])
      await expect(
        applyUnsafeDestinationHold({
          proposal: proposal(),
          report: evidence,
          reason: "Maintainer-reviewed unsafe destination report.",
          now: VERIFIED,
          readCommit: async () => signedCommit(evidence),
        }),
      ).rejects.toThrow();
    await expect(
      applyUnsafeDestinationHold({
        proposal: proposal(),
        report: report(),
        reason: "Maintainer-reviewed unsafe destination report.",
        now: "2026-08-17T00:00:00.000Z",
        readCommit: async () => signedCommit(),
      }),
    ).rejects.toThrow(/during review/u);
    await expect(
      applyUnsafeDestinationHold({
        proposal: proposal(),
        report: report(),
        reason: "",
        now: VERIFIED,
        readCommit: async () => signedCommit(),
      }),
    ).rejects.toThrow();
    const invalid = await heldProposal();
    invalid.allocations[0].approvedMinor = "1";
    expect(() => assertRewardAllocationManifest(invalid)).toThrow(
      /zero approved/u,
    );
  });

  it("carries exactly once across quiet cycles, retaining the block until a new safe claim exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-unsafe-carry-"));
    const held = await heldProposal();
    const directory = join(root, "eliza", "2026-07");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "proposal.json"), JSON.stringify(held));
    await writeFile(
      join(directory, "allocation.json"),
      JSON.stringify(
        finalizeRewardAllocation(
          held,
          held.review.endsAt,
          Date.parse(held.review.endsAt),
        ),
      ),
    );
    const prior = await loadPriorCycleAccrual({
      asOf: "2026-09-05T00:00:00.000Z",
      cycleId: "2026-08",
      cyclesRoot: root,
      projectId: "eliza",
    });
    expect([...prior.accruedMinor]).toEqual([["U_fixture", "5000000000"]]);
    const commandSnapshot = JSON.parse(
      JSON.stringify(snapshotFixture()).replaceAll("2026-07-", "2026-08-"),
    );
    for (const [index, event] of commandSnapshot.ledger.entries()) {
      event.scoreThirds = event.points * 3;
      event.workUnitId = `wu_unsafe_hold_${index}`;
    }
    commandSnapshot.generatedAt = new Date().toISOString();
    commandSnapshot.sourceUpdatedAt = commandSnapshot.generatedAt;
    commandSnapshot.window.from = "2026-08-01T00:00:00.000Z";
    commandSnapshot.window.to = "2026-09-05T00:00:00.000Z";
    commandSnapshot.source.fetchedAt = commandSnapshot.generatedAt;
    commandSnapshot.source.cutoffAt = commandSnapshot.window.to;
    commandSnapshot.source.verificationWindow.from =
      commandSnapshot.window.from;
    commandSnapshot.source.verificationWindow.to = commandSnapshot.window.to;
    const snapshotPath = join(root, "command-snapshot.json");
    await writeFile(snapshotPath, JSON.stringify(commandSnapshot));
    const prepared = await prepareRewardCycle(
      parsePrepareRewardCycleArguments([
        "--project",
        "eliza",
        "--cycle",
        "2026-08",
        "--snapshot",
        snapshotPath,
      ]),
      {
        generatedAt: commandSnapshot.window.to,
        loadPriorAccrual: async () => prior,
        observeWallet: async () => wallet(),
        write: async () => undefined,
        writeSnapshot: async () => undefined,
      },
    );
    if (prepared.kind !== "reward-allocation") throw new Error("wrong fixture");
    expect(prepared.allocations[0]).toMatchObject({
      state: "unclaimed",
      wallet: null,
      unsafeDestinationReports: [report()],
    });
    expect(prepared.carriedMinor).toBe("5000000000");
    const next = (candidate: SlopDatabaseWalletProof) => {
      const snapshot = snapshotFixture();
      snapshot.window.from = "2026-08-01T00:00:00.000Z";
      snapshot.window.to = "2026-09-05T00:00:00.000Z";
      snapshot.source.verificationWindow = {
        ...snapshot.source.verificationWindow,
        from: snapshot.window.from,
        to: snapshot.window.to,
      };
      return createRewardCycleProposal({
        cycleId: "2026-08",
        generatedAt: snapshot.window.to,
        projectId: "eliza",
        snapshot,
        sourceSnapshotSha256: "e".repeat(64),
        wallets: new Map([["U_fixture", candidate]]),
        priorAccruedMinor: prior.accruedMinor,
        priorActorLogins: prior.actorLogins,
        priorUnsafeDestinationReports: prior.unsafeDestinationReports,
      });
    };
    for (const candidate of [
      wallet(),
      wallet(
        "U_fixture",
        "claim_new_same_address",
        UNSAFE,
        "2026-08-04T00:00:00.000Z",
      ),
      wallet("U_fixture", "claim_old_other_address", SAFE),
    ]) {
      const result = next(candidate);
      if (result.kind !== "reward-allocation") throw new Error("wrong fixture");
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]).toMatchObject({
        state: "unclaimed",
        wallet: null,
        accruedMinor: "5000000000",
        unsafeDestinationReports: [report()],
      });
    }
    const pending = next(wallet());
    if (pending.kind !== "reward-allocation") throw new Error("wrong fixture");
    await mkdir(join(root, "eliza", "2026-08"), { recursive: true });
    await writeFile(
      join(root, "eliza", "2026-08", "proposal.json"),
      JSON.stringify(pending),
    );
    const twice = await loadPriorCycleAccrual({
      asOf: "2026-10-05T00:00:00.000Z",
      cycleId: "2026-09",
      cyclesRoot: root,
      projectId: "eliza",
    });
    expect([...twice.accruedMinor]).toEqual([["U_fixture", "5000000000"]]);
    expect(twice.unsafeDestinationReports?.get("U_fixture")).toEqual([
      report(),
    ]);
    const restored = next(
      wallet(
        "U_fixture",
        "claim_safe_successor",
        SAFE,
        "2026-08-04T00:00:00.000Z",
      ),
    );
    if (restored.kind !== "reward-allocation") throw new Error("wrong fixture");
    expect(restored.allocations[0]).toMatchObject({
      state: "proposed",
      wallet: { address: SAFE },
      suggestedMinor: "5000000000",
    });
    expect(restored.allocations[0].hold).toBeUndefined();
    const forged = structuredClone(restored);
    forged.allocations[0].wallet = wallet();
    expect(() => assertRewardAllocationManifest(forged)).toThrow(
      /safe successor/u,
    );
  });
});

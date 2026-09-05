import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRewardCycleProposal as createCycleProposal } from "../src/lib/reward-cycle";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  assertRewardAllocationManifest,
  feeForPrincipal,
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
import { verifyProposalAgainstSnapshot } from "./sync-cycle-index";
import {
  applyUnsafeDestinationHold,
  verifyUnsafeDestinationReport,
} from "./unsafe-destination-hold";

// Synthetic reviewed funding only; production pledges never create money.
function createRewardCycleProposal(
  input: Parameters<typeof createCycleProposal>[0],
) {
  return createCycleProposal({
    ...input,
    fundingBasis: input.fundingBasis ?? {
      cycleId: input.cycleId,
      instrumentId: `sablier-lockup-v4:base:0x${"1".repeat(40)}:1`,
      fundingState: "committed",
      committedMinor: "10000000000",
      monthlyCapMinor: "10000000000",
    },
  });
}

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
    suggestedMinor: proposal().allocations[0].suggestedMinor,
    carryMinor: proposal().allocations[0].suggestedMinor,
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
  it("fails closed on rewritten, orphaned, future, or symlinked historical evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-unsafe-history-boundary-"));
    const directory = join(root, "eliza", "2026-07");
    await mkdir(directory, { recursive: true });
    const held = await heldProposal();
    await writeFile(join(directory, "proposal.json"), JSON.stringify(held));
    const allocation = finalizeRewardAllocation(
      held,
      held.review.endsAt,
      Date.parse(held.review.endsAt),
    );
    const historicalReport =
      allocation.allocations[0].unsafeDestinationReports?.[0];
    if (!historicalReport) throw new Error("missing report fixture");
    historicalReport.verifiedAt = "2026-08-04T00:00:00.000Z";
    await writeFile(
      join(directory, "allocation.json"),
      JSON.stringify(allocation),
    );
    const load = (asOf = "2026-09-05T00:00:00.000Z") =>
      loadPriorCycleAccrual({
        cyclesRoot: root,
        projectId: "eliza",
        cycleId: "2026-08",
        asOf,
      });
    await expect(load()).rejects.toThrow(/changes an immutable report/u);
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
    await expect(load("2026-08-03T00:00:00.000Z")).rejects.toThrow(
      /future verification/u,
    );
    await symlink(directory, join(root, "eliza", "2026-06"), "dir");
    await expect(load()).rejects.toThrow(/non-canonical cycle directory/u);

    const orphanRoot = await mkdtemp(join(tmpdir(), "slop-unsafe-orphan-"));
    const snapshot = snapshotFixture();
    snapshot.window.from = "2026-08-01T00:00:00.000Z";
    snapshot.window.to = "2026-09-05T00:00:00.000Z";
    snapshot.source.verificationWindow.from = snapshot.window.from;
    snapshot.source.verificationWindow.to = snapshot.window.to;
    const orphan = createRewardCycleProposal({
      cycleId: "2026-08",
      generatedAt: snapshot.window.to,
      projectId: "eliza",
      snapshot,
      sourceSnapshotSha256: "e".repeat(64),
      priorAccruedMinor: new Map([["U_fixture", "5000000000"]]),
      priorActorLogins: new Map([["U_fixture", "finish-line"]]),
      priorUnsafeDestinationReports: new Map([["U_fixture", [report()]]]),
    });
    await mkdir(join(orphanRoot, "eliza", "2026-08"), { recursive: true });
    await writeFile(
      join(orphanRoot, "eliza", "2026-08", "proposal.json"),
      JSON.stringify(orphan),
    );
    await expect(
      loadPriorCycleAccrual({
        cyclesRoot: orphanRoot,
        projectId: "eliza",
        cycleId: "2026-09",
        asOf: "2026-10-05T00:00:00.000Z",
      }),
    ).rejects.toThrow(/missing its original reviewed hold/u);
  });

  it("refuses excessive historical inventories rather than truncating old safety evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-unsafe-history-limit-"));
    await mkdir(join(root, "eliza"), { recursive: true });
    for (let index = 0; index < 1201; index += 1) {
      const year = 1900 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, "0");
      await mkdir(join(root, "eliza", `${year}-${month}`));
    }
    await expect(
      loadPriorCycleAccrual({
        cyclesRoot: root,
        projectId: "eliza",
        cycleId: "2026-08",
        asOf: "2026-09-05T00:00:00.000Z",
      }),
    ).rejects.toThrow(/cycle limit/u);
  });

  it("never forgets unsafe destinations after approval, a zero-participation cycle, or missing immediate carry", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-unsafe-persistent-"));
    const writeCycle = async (
      value: RewardAllocationManifest,
      approve = false,
    ) => {
      const directory = join(root, "eliza", value.cycleId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "proposal.json"), JSON.stringify(value));
      if (approve)
        await writeFile(
          join(directory, "allocation.json"),
          JSON.stringify(
            finalizeRewardAllocation(
              value,
              value.review.endsAt,
              Date.parse(value.review.endsAt),
            ),
          ),
        );
    };
    const makeSnapshot = (
      month: string,
      nextMonth: string,
      newWork = false,
    ) => {
      const bytes = JSON.stringify(snapshotFixture());
      const snapshot = JSON.parse(
        newWork ? bytes.replaceAll("2026-07-", `2026-${month}-`) : bytes,
      );
      snapshot.window.from = `2026-${month}-01T00:00:00.000Z`;
      snapshot.window.to = `2026-${nextMonth}-05T00:00:00.000Z`;
      snapshot.source.verificationWindow.from = snapshot.window.from;
      snapshot.source.verificationWindow.to = snapshot.window.to;
      return snapshot;
    };
    const load = (cycleId: string, asOf: string) =>
      loadPriorCycleAccrual({
        cyclesRoot: root,
        projectId: "eliza",
        cycleId,
        asOf,
      });
    const create = (
      cycleId: string,
      snapshot: ReturnType<typeof makeSnapshot>,
      prior: Awaited<ReturnType<typeof load>>,
      candidate?: SlopDatabaseWalletProof,
    ) => {
      const result = createRewardCycleProposal({
        cycleId,
        generatedAt: snapshot.window.to,
        projectId: "eliza",
        snapshot,
        sourceSnapshotSha256: "e".repeat(64),
        wallets: candidate ? new Map([["U_fixture", candidate]]) : new Map(),
        priorAccruedMinor: prior.accruedMinor,
        priorActorLogins: prior.actorLogins,
        priorUnsafeDestinationReports: prior.unsafeDestinationReports,
      });
      if (result.kind !== "reward-allocation") throw new Error("wrong fixture");
      return result;
    };
    await writeCycle(await heldProposal(), true);
    const august = create(
      "2026-08",
      makeSnapshot("08", "09"),
      await load("2026-08", "2026-09-05T00:00:00.000Z"),
      wallet(
        "U_fixture",
        "claim_safe_successor",
        SAFE,
        "2026-08-04T00:00:00.000Z",
      ),
    );
    expect(august.allocations[0].state).toBe("proposed");
    august.allocations[0].state = "approved";
    august.allocations[0].approvedMinor = august.allocations[0].suggestedMinor;
    august.totals.approvedMinor = august.allocations[0].approvedMinor;
    august.totals.feeMinor = feeForPrincipal(
      august.totals.approvedMinor,
      august.feeBasisPoints,
    );
    await writeCycle(august, true);
    const afterApproval = await load("2026-09", "2026-10-05T00:00:00.000Z");
    expect([...afterApproval.accruedMinor]).toEqual([]);
    expect(afterApproval.unsafeDestinationReports?.get("U_fixture")).toEqual([
      report(),
    ]);
    const september = create(
      "2026-09",
      makeSnapshot("09", "10"),
      afterApproval,
    );
    expect(september.allocations).toEqual([]);
    await writeCycle(september);
    const afterAbsence = await load("2026-10", "2026-11-05T00:00:00.000Z");
    expect([...afterAbsence.accruedMinor]).toEqual([]);
    expect(afterAbsence.unsafeDestinationReports?.get("U_fixture")).toEqual([
      report(),
    ]);
    for (const candidate of [
      wallet(),
      wallet(
        "U_fixture",
        "claim_republished_unsafe",
        UNSAFE,
        "2026-10-20T00:00:00.000Z",
      ),
    ]) {
      const returned = create(
        "2026-10",
        makeSnapshot("10", "11", true),
        afterAbsence,
        candidate,
      );
      expect(returned.allocations[0]).toMatchObject({
        state: "unclaimed",
        wallet: null,
        unsafeDestinationReports: [report()],
      });
      expect(returned.carriedMinor).toBe("0");
    }
    const safeAgain = create(
      "2026-10",
      makeSnapshot("10", "11", true),
      afterAbsence,
      wallet(
        "U_fixture",
        "claim_safe_successor",
        SAFE,
        "2026-08-04T00:00:00.000Z",
      ),
    );
    expect(safeAgain.allocations[0]).toMatchObject({
      state: "proposed",
      wallet: { address: SAFE },
    });
    // A gap in financial carry must not erase older safety history either.
    const afterGap = await load("2026-11", "2026-12-05T00:00:00.000Z");
    expect([...afterGap.accruedMinor]).toEqual([]);
    expect(afterGap.unsafeDestinationReports?.get("U_fixture")).toEqual([
      report(),
    ]);
  });

  it("rejects same-cycle wallet substitution even after advancing the review clock", async () => {
    const held = await heldProposal();
    const changed = structuredClone(held);
    const row = changed.allocations[0];
    delete row.hold;
    row.wallet = wallet(
      "U_fixture",
      "claim_safe_same_cycle",
      SAFE,
      "2026-08-04T00:00:00.000Z",
    );
    row.state = "approved";
    row.approvedMinor = row.suggestedMinor;
    changed.review.lastMaterialChangeAt = "2026-08-04T00:00:00.000Z";
    changed.review.endsAt = "2026-08-18T00:00:00.000Z";
    changed.totals.approvedMinor = "10000000000";
    changed.totals.feeMinor = "100000000";
    expect(() => assertRewardAllocationManifest(changed)).toThrow(
      /current-cycle unsafe destination/u,
    );
    expect(() =>
      finalizeRewardAllocation(
        changed,
        changed.review.endsAt,
        Date.parse(changed.review.endsAt),
      ),
    ).toThrow(/current-cycle unsafe destination/u);
    row.state = "unclaimed";
    row.wallet = null;
    row.approvedMinor = "0";
    changed.totals.approvedMinor = "5000000000";
    changed.totals.feeMinor = "50000000";
    expect(() => assertRewardAllocationManifest(changed)).toThrow(
      /current-cycle unsafe destination/u,
    );
  });
  it("rejects inflated principal in signed reports, standalone validation, finalization, and carry loading", async () => {
    const held = await heldProposal();
    held.allocations[0].accruedMinor = "999999999999999";
    expect(() => assertRewardAllocationManifest(held)).toThrow(
      /reviewed suggested amount/u,
    );
    expect(() =>
      finalizeRewardAllocation(
        held,
        held.review.endsAt,
        Date.parse(held.review.endsAt),
      ),
    ).toThrow(/reviewed suggested amount/u);
    const root = await mkdtemp(join(tmpdir(), "slop-inflated-hold-"));
    const directory = join(root, "eliza", "2026-07");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "proposal.json"), JSON.stringify(held));
    await expect(
      loadPriorCycleAccrual({
        asOf: "2026-09-05T00:00:00.000Z",
        cycleId: "2026-08",
        cyclesRoot: root,
        projectId: "eliza",
      }),
    ).rejects.toThrow(/not a valid reward allocation/u);
    const inflated = { ...report(), suggestedMinor: "999999999999999" };
    await expect(
      verifyUnsafeDestinationReport(inflated, async () => signedCommit()),
    ).rejects.toThrow(/does not bind/u);
    await expect(
      applyUnsafeDestinationHold({
        proposal: proposal(),
        report: inflated,
        reason: "Maintainer-reviewed unsafe destination report.",
        now: VERIFIED,
        readCommit: async () => signedCommit(inflated),
      }),
    ).rejects.toThrow(/does not match/u);
    const invalidTotal = await heldProposal();
    invalidTotal.totals.suggestedMinor = "999999999999999";
    expect(() => assertRewardAllocationManifest(invalidTotal)).toThrow(
      /totals/u,
    );
  });

  it("binds accrued principal and total carry to the frozen snapshot baseline", async () => {
    const snapshot = snapshotFixture();
    snapshot.window.from = "2026-06-28T00:00:00.000Z";
    snapshot.window.to = GENERATED;
    snapshot.source.verificationWindow.from = snapshot.window.from;
    snapshot.source.verificationWindow.to = snapshot.window.to;
    const baseline = createRewardCycleProposal({
      cycleId: "2026-07",
      generatedAt: GENERATED,
      projectId: "eliza",
      snapshot,
      sourceSnapshotSha256: "a".repeat(64),
    });
    if (baseline.kind !== "reward-allocation") throw new Error("wrong fixture");
    await expect(
      verifyProposalAgainstSnapshot(baseline, snapshot, "a".repeat(64)),
    ).resolves.toBeUndefined();
    const inflatedAccrual = structuredClone(baseline);
    inflatedAccrual.allocations[0].accruedMinor = "999999999999999";
    await expect(
      verifyProposalAgainstSnapshot(inflatedAccrual, snapshot, "a".repeat(64)),
    ).rejects.toThrow(/frozen snapshot/u);
    const inflatedCarry = structuredClone(baseline);
    inflatedCarry.carriedMinor = "999999999999999";
    await expect(
      verifyProposalAgainstSnapshot(inflatedCarry, snapshot, "a".repeat(64)),
    ).rejects.toThrow(/frozen snapshot/u);
  });
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

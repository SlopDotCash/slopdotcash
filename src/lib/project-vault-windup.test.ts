/** Synthetic fixtures only: no production vault, plan, refund, or wallet claim. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProjectCommitmentRecord } from "./funding-commitment";
import {
  assertProjectVaultWindup,
  deriveProjectVaultWindup,
  projectVaultWindupReason,
  projectVaultWindupRefunds,
} from "./project-vault-windup";
import { assertRewardAllocationManifest } from "./rewards";
import { createSettlementExecutionPlan } from "./settlement-plan";
import { deriveSquadsVaultAddress } from "./squads-funding";

const RECIPIENT = "11111111111111111111111111111111";
const MULTISIG = "Vote111111111111111111111111111111111111111";
const FEE = "Stake11111111111111111111111111111111111111";
const PROPOSAL = "SysvarRent111111111111111111111111111111111";
const TRANSACTION = "SysvarC1ock11111111111111111111111111111111";
const CREATOR = "Config1111111111111111111111111111111111111";
const SLOP = "BPFLoaderUpgradeab1e11111111111111111111111";
const INDEPENDENT = "ComputeBudget111111111111111111111111111111";
const COMMIT = "a".repeat(40);
const APPROVED_AT = "2026-08-15T00:00:00.000Z";
const REFUND_AT = "2026-08-20T00:00:00.000Z";
const OBSERVED_AT = "2026-08-21T00:00:00.000Z";
const RECORDED_AT = "2026-08-21T00:05:00.000Z";

async function fixture() {
  const vault = await deriveSquadsVaultAddress(MULTISIG, 0);
  const instrumentId = `squads-project-vault:solana:${MULTISIG}:0:${vault}`;
  const allocation = assertRewardAllocationManifest({
    fundingBasis: {
      cycleId: "2026-07",
      fundingState: "committed",
      committedMinor: "10000000000",
      monthlyCapMinor: "10000000000",
      instrumentId,
    },
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "approved",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: APPROVED_AT,
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
      endsAt: APPROVED_AT,
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_u1",
        actor: { id: "U_1", login: "contributor" },
        score: 100,
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        state: "approved",
        wallet: {
          address: RECIPIENT,
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/contributor/contributor/blob/${COMMIT}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    },
  });
  const allocationBytes = Buffer.from(JSON.stringify(allocation));
  const allocationSha256 = createHash("sha256")
    .update(allocationBytes)
    .digest("hex");
  const plan = createSettlementExecutionPlan({
    allocation,
    allocationSha256,
    createdAt: "2026-08-16T00:00:00.000Z",
    feeRecipient: FEE,
    sourceOwner: vault,
  });
  const planBytes = Buffer.from(JSON.stringify(plan));
  const planSha256 = createHash("sha256").update(planBytes).digest("hex");
  const binding = {
    schemaVersion: "1",
    kind: "squads-execution-binding",
    projectId: "eliza",
    cycleId: "2026-07",
    planSha256,
    multisig: MULTISIG,
    vault,
    vaultIndex: 0,
    transactionIndex: "1",
    proposalAccount: PROPOSAL,
    vaultTransactionAccount: TRANSACTION,
  };
  const refund = (
    overrides: Partial<ProjectCommitmentRecord> = {},
  ): ProjectCommitmentRecord => ({
    schemaVersion: "1",
    kind: "project-commitment",
    recordId: "cmt_windup_refund_01",
    projectId: "eliza",
    manifestRevision: COMMIT,
    event: "refund",
    network: "solana",
    asset: "USDC",
    instrument: {
      creatorMember: CREATOR,
      independentMember: INDEPENDENT,
      multisig: MULTISIG,
      slopMember: SLOP,
      vault,
      vaultIndex: 0,
    },
    transactionId: "5".repeat(88),
    amountMinor: "1000000",
    observedAt: REFUND_AT,
    state: "verified-on-chain",
    finality: { kind: "finalized" },
    verifier: {
      version: "project-vault-squads-v1",
      checkedAt: REFUND_AT,
      evidenceUrl: `https://solscan.io/tx/${"5".repeat(88)}`,
      reason: null,
    },
    supersedes: null,
    ...overrides,
  });
  const context = {
    allocation,
    allocationSha256,
    planBytes,
    ledger: [binding],
  };
  const derive = (
    overrides: Partial<Parameters<typeof deriveProjectVaultWindup>[0]> = {},
  ) =>
    deriveProjectVaultWindup({
      ...context,
      fundingRecords: [refund()],
      vaultBalanceMinor: "0",
      observedAt: OBSERVED_AT,
      recordedAt: RECORDED_AT,
      ...overrides,
    });
  return { allocation, binding, context, derive, instrumentId, refund, vault };
}

describe("project vault windup record (RFC #500 section 10)", () => {
  it("holds every approved row against the bound proposal and pays nothing", async () => {
    const f = await fixture();
    const windup = await f.derive();
    expect(windup).toMatchObject({
      kind: "project-vault-windup",
      instrumentId: f.instrumentId,
      binding: { transactionIndex: "1", proposalAccount: PROPOSAL },
      requiredMinor: "1000000",
      vaultBalanceMinor: "0",
      rows: [
        {
          intentId: "pay_eliza_2026_07_u1",
          approvedMinor: "1000000",
          state: "held",
        },
      ],
    });
    expect(windup.refunds).toEqual([
      {
        recordId: "cmt_windup_refund_01",
        transactionId: "5".repeat(88),
        amountMinor: "1000000",
        observedAt: REFUND_AT,
      },
    ]);
    expect(windup.reason).toBe(
      projectVaultWindupReason(windup.refunds, "1000000", "0"),
    );
    expect(windup.reason).toContain("5".repeat(88));
    expect(windup.reason).toMatch(/not a decision against any contributor/u);
    expect(windup.reason).toMatch(/nothing is paid, carried, or reissued/u);
    expect(await assertProjectVaultWindup(windup, f.context)).toEqual(windup);
    expect(
      await assertProjectVaultWindup(windup, {
        ...f.context,
        fundingRecords: [f.refund()],
      }),
    ).toEqual(windup);
  });
  it("records nothing while the vault still covers the proposal or no refund followed approval", async () => {
    const f = await fixture();
    await expect(f.derive({ vaultBalanceMinor: "1000000" })).rejects.toThrow(
      /still covers/u,
    );
    await expect(f.derive({ fundingRecords: [] })).rejects.toThrow(
      /No verified refund/u,
    );
    await expect(
      f.derive({
        fundingRecords: [f.refund({ observedAt: "2026-08-10T00:00:00.000Z" })],
      }),
    ).rejects.toThrow(/No verified refund/u);
    await expect(
      f.derive({ fundingRecords: [f.refund({ event: "deposit" })] }),
    ).rejects.toThrow(/No verified refund/u);
    await expect(
      f.derive({ observedAt: "2026-08-19T00:00:00.000Z" }),
    ).rejects.toThrow(/observed after every refund/u);
    expect(
      projectVaultWindupRefunds(
        [f.refund({ state: "pending" as ProjectCommitmentRecord["state"] })],
        f.binding,
        APPROVED_AT,
      ),
    ).toEqual([]);
  });
  it("requires a bound proposal and refuses another vault, plan, or row set", async () => {
    const f = await fixture();
    await expect(f.derive({ ledger: [] })).rejects.toThrow(/approved-unbound/u);
    const windup = await f.derive();
    await expect(
      assertProjectVaultWindup(
        { ...windup, binding: { ...windup.binding, transactionIndex: "2" } },
        f.context,
      ),
    ).rejects.toThrow(/does not bind/u);
    await expect(
      assertProjectVaultWindup(
        { ...windup, planSha256: "c".repeat(64) },
        f.context,
      ),
    ).rejects.toThrow(/does not bind/u);
    await expect(
      assertProjectVaultWindup(
        { ...windup, rows: [{ ...windup.rows[0], state: "approved" }] },
        f.context,
      ),
    ).rejects.toThrow(/approved intent/u);
    await expect(
      assertProjectVaultWindup({ ...windup, rows: [] }, f.context),
    ).rejects.toThrow(/rows do not match/u);
    await expect(
      assertProjectVaultWindup(
        { ...windup, vaultBalanceMinor: "1000000" },
        f.context,
      ),
    ).rejects.toThrow(/still covers/u);
    await expect(
      assertProjectVaultWindup({ ...windup, reason: "Wound up." }, f.context),
    ).rejects.toThrow(/canonical public reason/u);
    await expect(
      assertProjectVaultWindup({ ...windup, refunds: [] }, f.context),
    ).rejects.toThrow(/names no refund/u);
    await expect(
      assertProjectVaultWindup({ ...windup, extra: true }, f.context),
    ).rejects.toThrow(/unexpected or missing fields/u);
  });
  it("cross-checks named refunds against the verified funding ledger when given", async () => {
    const f = await fixture();
    const windup = await f.derive();
    await expect(
      assertProjectVaultWindup(windup, { ...f.context, fundingRecords: [] }),
    ).rejects.toThrow(/verified funding ledger does not hold/u);
    await expect(
      assertProjectVaultWindup(windup, {
        ...f.context,
        fundingRecords: [f.refund({ amountMinor: "999999" })],
      }),
    ).rejects.toThrow(/verified funding ledger does not hold/u);
  });
});

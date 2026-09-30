/** Synthetic fixtures only: no production vault, plan, or wallet claim. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertProjectVaultApprovalBinding,
  isProjectVaultInstrumentId,
  parseProjectVaultInstrumentId,
  projectVaultApprovalState,
} from "./project-vault-approval";
import { assertRewardAllocationManifest } from "./rewards";
import { createSettlementExecutionPlan } from "./settlement-plan";
import { deriveSquadsVaultAddress } from "./squads-funding";

const RECIPIENT = "11111111111111111111111111111111";
const MULTISIG = "Vote111111111111111111111111111111111111111";
const FEE = "Stake11111111111111111111111111111111111111";
const PROPOSAL = "SysvarRent111111111111111111111111111111111";
const TRANSACTION = "SysvarC1ock11111111111111111111111111111111";
const OTHER_MULTISIG = "Config1111111111111111111111111111111111111";
const COMMIT = "a".repeat(40);

async function fixture(
  overrides: { status?: "approved" | "proposed"; fundingBasis?: false } = {},
) {
  const vault = await deriveSquadsVaultAddress(MULTISIG, 0);
  const instrumentId = `squads-project-vault:solana:${MULTISIG}:0:${vault}`;
  const approved = overrides.status !== "proposed";
  const allocation = assertRewardAllocationManifest({
    ...(overrides.fundingBasis === false
      ? {}
      : {
          fundingBasis: {
            cycleId: "2026-07",
            fundingState: "committed",
            committedMinor: "10000000000",
            monthlyCapMinor: "10000000000",
            instrumentId,
          },
        }),
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: approved ? "approved" : "proposed",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: approved ? "2026-08-15T00:00:00.000Z" : null,
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-15T00:00:00.000Z",
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
        approvedMinor: approved ? "1000000" : "0",
        state: approved ? "approved" : "proposed",
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
      approvedMinor: approved ? "1000000" : "0",
      feeMinor: approved ? "10000" : "0",
    },
  });
  const allocationBytes = Buffer.from(JSON.stringify(allocation));
  const allocationSha256 = createHash("sha256")
    .update(allocationBytes)
    .digest("hex");
  const plan = approved
    ? createSettlementExecutionPlan({
        allocation,
        allocationSha256,
        createdAt: "2026-08-16T00:00:00.000Z",
        feeRecipient: FEE,
        sourceOwner: vault,
      })
    : null;
  const planBytes = Buffer.from(JSON.stringify(plan ?? {}));
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
  return { allocation, planBytes, binding, vault, instrumentId };
}

describe("project vault instrument identities", () => {
  it("recognises only the project vault kind", async () => {
    const { instrumentId, vault } = await fixture();
    expect(isProjectVaultInstrumentId(instrumentId)).toBe(true);
    expect(parseProjectVaultInstrumentId(instrumentId)).toEqual({
      multisig: MULTISIG,
      vaultIndex: 0,
      vault,
    });
    expect(
      isProjectVaultInstrumentId(
        `squads-v4-vault:solana:${MULTISIG}:0:${vault}`,
      ),
    ).toBe(false);
    expect(() =>
      parseProjectVaultInstrumentId(
        `squads-v4-vault:solana:${MULTISIG}:0:${vault}`,
      ),
    ).toThrow(/Not a project vault instrument identity/u);
    expect(() =>
      parseProjectVaultInstrumentId(
        `squads-project-vault:solana:${MULTISIG}:256:${vault}`,
      ),
    ).toThrow(/Not a project vault instrument identity/u);
  });
});

describe("project vault approval binding (RFC #500 section 3)", () => {
  it("reports an allocation without a project vault as not applicable", async () => {
    const { allocation, planBytes } = await fixture({ fundingBasis: false });
    const report = await projectVaultApprovalState({
      allocation,
      planBytes,
      ledger: [],
    });
    expect(report.state).toBe("not-a-project-vault");
    expect(report.binding).toBeNull();
  });

  it("reports a proposed allocation as not approved before reading any plan", async () => {
    const { allocation } = await fixture({ status: "proposed" });
    const report = await projectVaultApprovalState({
      allocation,
      planBytes: Buffer.from("not json"),
      ledger: [],
    });
    expect(report.state).toBe("not-approved");
  });

  it("keeps an approved allocation unbound until the creator's proposal is in the ledger", async () => {
    const { allocation, planBytes } = await fixture();
    const report = await projectVaultApprovalState({
      allocation,
      planBytes,
      ledger: [],
    });
    expect(report.state).toBe("approved-unbound");
    expect(report.reasons[0]).toMatch(
      /nothing exists for a signer to release/u,
    );
    await expect(
      assertProjectVaultApprovalBinding({ allocation, planBytes, ledger: [] }),
    ).rejects.toThrow(/approval is approved-unbound/u);
  });

  it("binds only when the ledger row names this vault and these exact plan bytes", async () => {
    const { allocation, planBytes, binding } = await fixture();
    const report = await projectVaultApprovalState({
      allocation,
      planBytes,
      ledger: [binding],
    });
    expect(report.state).toBe("approved-bound");
    expect(report.binding).toEqual(binding);
    await expect(
      assertProjectVaultApprovalBinding({
        allocation,
        planBytes,
        ledger: [binding],
      }),
    ).resolves.toEqual(binding);
  });

  it("refuses a ledger row written for different plan bytes", async () => {
    const { allocation, planBytes, binding } = await fixture();
    await expect(
      projectVaultApprovalState({
        allocation,
        planBytes,
        ledger: [{ ...binding, planSha256: "c".repeat(64) }],
      }),
    ).rejects.toThrow(/written for different plan bytes/u);
  });

  it("refuses a ledger row that names another vault for the same cycle", async () => {
    const { allocation, planBytes, binding } = await fixture();
    const otherVault = await deriveSquadsVaultAddress(OTHER_MULTISIG, 0);
    await expect(
      projectVaultApprovalState({
        allocation,
        planBytes,
        ledger: [{ ...binding, multisig: OTHER_MULTISIG, vault: otherVault }],
      }),
    ).rejects.toThrow(/names a different vault/u);
  });

  it("never lets a plan draw a project vault cycle from another wallet", async () => {
    const { allocation } = await fixture();
    const allocationSha256 = createHash("sha256")
      .update(Buffer.from(JSON.stringify(allocation)))
      .digest("hex");
    expect(() =>
      createSettlementExecutionPlan({
        allocation,
        allocationSha256,
        createdAt: "2026-08-16T00:00:00.000Z",
        feeRecipient: FEE,
        sourceOwner: OTHER_MULTISIG,
      }),
    ).toThrow(/source owner must match the frozen funding vault/u);
  });
});

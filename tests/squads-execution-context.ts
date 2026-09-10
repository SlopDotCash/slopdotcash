import { createHash } from "node:crypto";
/** Approved exact-byte context based on the Squads decoder fixture. */
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import type { SettlementExecutionPlan } from "../src/lib/settlement-plan";
import { createSettlementExecutionPlan } from "../src/lib/settlement-plan";
import { compileSquadsBatchChild } from "../src/lib/squads-batch-message";
import {
  assertSquadsBindingLedger,
  executionSha256,
} from "../src/lib/squads-execution";
import {
  squadsBatchChildAddress,
  squadsExecutionAddress,
} from "../src/lib/squads-execution-verifier";
import { deriveSquadsVaultAddress } from "../src/lib/squads-funding";

const RECIPIENT = "11111111111111111111111111111111";
const SOURCE = "Vote111111111111111111111111111111111111111";
const FEE = "Stake11111111111111111111111111111111111111";
const COMMIT = "a".repeat(40);
function approvedAllocation() {
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "approved",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: "2026-08-15T00:00:00.000Z",
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
}

function recipientAddress(index: number): string {
  const bytes = createHash("sha256")
    .update(`registry-recipient-${index}`)
    .digest();
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let address = "";
  while (value > 0n) {
    address = alphabet[Number(value % 58n)] + address;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    address = `1${address}`;
  }
  return address;
}
export async function executionContext(contributors = 1) {
  const vault = await deriveSquadsVaultAddress(SOURCE, 0);
  const base = approvedAllocation();
  const allocation = {
    ...base,
    allocations: Array.from({ length: contributors }, (_, index) => {
      const row = base.allocations[0];
      if (!row.wallet) throw new Error("Fixture requires a wallet");
      return {
        ...row,
        intentId: `pay_eliza_2026_07_u${index + 1}`,
        actor: { id: `U_${index + 1}`, login: `contributor${index + 1}` },
        wallet: {
          ...row.wallet,
          address:
            contributors === 1 ? row.wallet.address : recipientAddress(index),
          sourceUrl: `https://github.com/contributor${index + 1}/contributor${index + 1}/blob/${COMMIT}/README.md`,
        },
      };
    }),
    totals: {
      suggestedMinor: String(contributors * 1000000),
      approvedMinor: String(contributors * 1000000),
      feeMinor: String(contributors * 10000),
    },
    fundingBasis: {
      cycleId: "2026-07",
      fundingState: "committed",
      committedMinor: "10000000000",
      monthlyCapMinor: "10000000000",
      instrumentId: `squads-v4-vault:solana:${SOURCE}:0:${vault}`,
    },
  };
  const allocationBytes = new TextEncoder().encode(JSON.stringify(allocation));
  const allocationSha256 = await executionSha256(allocationBytes);
  const plan = createSettlementExecutionPlan({
    allocation,
    allocationSha256,
    createdAt: "2026-08-15T00:01:00.000Z",
    feeRecipient: FEE,
    sourceOwner: vault,
  });
  const planBytes = new TextEncoder().encode(JSON.stringify(plan));
  const ledger = assertSquadsBindingLedger([
    {
      schemaVersion: "1",
      kind: "squads-execution-binding",
      projectId: "eliza",
      cycleId: "2026-07",
      planSha256: await executionSha256(planBytes),
      multisig: SOURCE,
      vault,
      vaultIndex: 0,
      transactionIndex: "1",
      proposalAccount: (await squadsExecutionAddress(SOURCE, "1", true))
        .address,
      vaultTransactionAccount: (
        await squadsExecutionAddress(SOURCE, "1", false)
      ).address,
    },
  ]);
  return { allocationBytes, planBytes, ledger, allocationSha256 };
}

/** Schema/registry fixture using the shared canonical Batch child PDA helper. */
export async function batchExecutionContext(contributors = 55) {
  const context = await executionContext(contributors);
  const single = context.ledger[0];
  if (single.kind !== "squads-execution-binding")
    throw new Error("Expected single binding fixture");
  const plan = JSON.parse(
    new TextDecoder().decode(context.planBytes),
  ) as SettlementExecutionPlan;
  const children = [];
  for (let offset = 0; offset < plan.transfers.length; offset += 5) {
    const transferIndexes = Array.from(
      { length: Math.min(5, plan.transfers.length - offset) },
      (_, index) => offset + index,
    );
    const child = await compileSquadsBatchChild(plan, transferIndexes);
    children.push({
      transactionIndex: children.length + 1,
      transactionAccount: (
        await squadsBatchChildAddress(
          SOURCE,
          single.transactionIndex,
          children.length + 1,
        )
      ).address,
      messageSha256: await executionSha256(child.storedBytes),
      transferIndexes,
    });
  }
  const { vaultTransactionAccount, ...common } = single;
  const ledger = assertSquadsBindingLedger([
    {
      ...common,
      schemaVersion: "2",
      kind: "squads-batch-execution-binding",
      batchAccount: vaultTransactionAccount,
      children,
    },
  ]);
  return { ...context, ledger };
}

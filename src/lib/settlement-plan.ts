/**
 * Builds and validates unsigned Solana USDC transfer plans from approved payout
 * intents. Plans contain public addresses and exact integer amounts only; no
 * signer, seed phrase, private key, or optimistic payment state is accepted.
 */

import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
} from "./rewards";
import { isSolanaAddress } from "./wallets";

export const SETTLEMENT_PLAN_SCHEMA_VERSION = "1" as const;
export const SOLANA_MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;
export const USDC_DECIMALS = 6 as const;
export const MAX_TRANSFERS_PER_PLAN = 200;

export interface SettlementPlanTransfer {
  paymentId: string;
  kind: "contributor" | "platform-fee";
  intentIds: string[];
  recipientOwner: string;
  amountMinor: string;
}

export interface SettlementExecutionPlan {
  schemaVersion: typeof SETTLEMENT_PLAN_SCHEMA_VERSION;
  kind: "solana-usdc-transfer-plan";
  status: "unsigned";
  projectId: string;
  cycleId: string;
  createdAt: string;
  allocationSha256: string;
  cluster: "mainnet-beta";
  token: {
    symbol: "USDC";
    mint: typeof SOLANA_MAINNET_USDC_MINT;
    decimals: typeof USDC_DECIMALS;
  };
  sourceOwner: string;
  transfers: SettlementPlanTransfer[];
  totals: {
    contributorMinor: string;
    platformFeeMinor: string;
    totalMinor: string;
  };
}

function decimalTokenAmount(amountMinor: string): string {
  const canonical = minor(amountMinor, "payment request amountMinor");
  const padded = canonical.padStart(USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -USDC_DECIMALS);
  const fraction = padded.slice(-USDC_DECIMALS);
  return `${whole}.${fraction}`;
}

/**
 * Creates a standard non-custodial Solana Pay request for one immutable plan
 * transfer. A wallet still shows and signs the ordinary USDC transfer, and the
 * cycle remains unpaid until finalized deltas are independently verified.
 */
export function createSolanaPayTransferRequest(
  plan: SettlementExecutionPlan,
  transfer: SettlementPlanTransfer,
): string {
  if (
    plan.cluster !== "mainnet-beta" ||
    plan.token.mint !== SOLANA_MAINNET_USDC_MINT ||
    plan.token.decimals !== USDC_DECIMALS ||
    !plan.transfers.some(
      (candidate) =>
        candidate.paymentId === transfer.paymentId &&
        candidate.recipientOwner === transfer.recipientOwner &&
        candidate.amountMinor === transfer.amountMinor,
    )
  ) {
    throw new TypeError("Payment request transfer is not in the mainnet plan");
  }
  const recipient = address(transfer.recipientOwner, "recipientOwner");
  const query = new URLSearchParams({
    amount: decimalTokenAmount(transfer.amountMinor),
    "spl-token": SOLANA_MAINNET_USDC_MINT,
    label: "Slop",
    message: `${plan.projectId} ${plan.cycleId} payout`,
    memo: transfer.paymentId,
  });
  return `solana:${recipient}?${query.toString()}`;
}

function exactUtc(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(
      "Settlement plan createdAt must be an exact UTC timestamp",
    );
  }
  return value;
}

function address(value: string, field: string): string {
  if (!isSolanaAddress(value)) {
    throw new TypeError(`${field} must be a Solana public key`);
  }
  return value;
}

/** Creates the exact unsigned transfers an external creator wallet must sign. */
export function createSettlementExecutionPlan(input: {
  allocation: unknown;
  allocationSha256: string;
  createdAt: string;
  feeRecipient: string;
  sourceOwner: string;
}): SettlementExecutionPlan {
  const allocation = assertRewardAllocationManifest(input.allocation);
  if (allocation.status !== "approved") {
    throw new TypeError("Settlement requires an approved allocation manifest");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.allocationSha256)) {
    throw new TypeError("Settlement allocation digest is invalid");
  }
  const sourceOwner = address(input.sourceOwner, "sourceOwner");
  const approved = allocation.allocations.filter(
    (row) => row.state === "approved",
  );
  if (approved.length === 0) {
    throw new RangeError("Approved allocation contains no payable intents");
  }
  if (approved.length + 1 > MAX_TRANSFERS_PER_PLAN) {
    throw new RangeError("Settlement exceeds the bounded transfer-plan limit");
  }
  const transfers: SettlementPlanTransfer[] = approved.map((row) => {
    if (!row.wallet) throw new TypeError(`${row.intentId} has no wallet`);
    const recipientOwner = address(
      row.wallet.address,
      `${row.intentId} wallet`,
    );
    if (recipientOwner === sourceOwner) {
      throw new TypeError(`${row.intentId} cannot pay the source wallet`);
    }
    return {
      paymentId: `contributor_${row.intentId}`,
      kind: "contributor",
      intentIds: [row.intentId],
      recipientOwner,
      amountMinor: row.approvedMinor,
    };
  });
  const platformFeeMinor = allocation.totals.feeMinor;
  if (BigInt(platformFeeMinor) > 0n) {
    const feeRecipient = address(input.feeRecipient, "feeRecipient");
    if (feeRecipient === sourceOwner) {
      throw new TypeError("Platform fee cannot pay the source wallet");
    }
    transfers.push({
      paymentId: `platform_fee_${allocation.projectId.replace(/[^a-z0-9]+/gu, "_")}_${allocation.cycleId.replace("-", "_")}`,
      kind: "platform-fee",
      intentIds: [],
      recipientOwner: feeRecipient,
      amountMinor: platformFeeMinor,
    });
  }
  const contributorMinor = approved
    .reduce((total, row) => total + BigInt(row.approvedMinor), 0n)
    .toString();
  return {
    schemaVersion: SETTLEMENT_PLAN_SCHEMA_VERSION,
    kind: "solana-usdc-transfer-plan",
    status: "unsigned",
    projectId: allocation.projectId,
    cycleId: allocation.cycleId,
    createdAt: exactUtc(input.createdAt),
    allocationSha256: input.allocationSha256,
    cluster: "mainnet-beta",
    token: {
      symbol: "USDC",
      mint: SOLANA_MAINNET_USDC_MINT,
      decimals: USDC_DECIMALS,
    },
    sourceOwner,
    transfers,
    totals: {
      contributorMinor,
      platformFeeMinor,
      totalMinor: (
        BigInt(contributorMinor) + BigInt(platformFeeMinor)
      ).toString(),
    },
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function minor(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`${field} must be canonical integer minor units`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Revalidates an execution plan loaded from a public cycle file. */
export function assertSettlementExecutionPlan(
  value: unknown,
  allocation: RewardAllocationManifest,
): SettlementExecutionPlan {
  const plan = record(value, "settlement plan");
  exactKeys(
    plan,
    [
      "allocationSha256",
      "cluster",
      "createdAt",
      "cycleId",
      "kind",
      "projectId",
      "schemaVersion",
      "sourceOwner",
      "status",
      "token",
      "totals",
      "transfers",
    ],
    "settlement plan",
  );
  if (
    plan.schemaVersion !== SETTLEMENT_PLAN_SCHEMA_VERSION ||
    plan.kind !== "solana-usdc-transfer-plan" ||
    plan.status !== "unsigned" ||
    plan.projectId !== allocation.projectId ||
    plan.cycleId !== allocation.cycleId ||
    plan.cluster !== "mainnet-beta"
  ) {
    throw new TypeError("Settlement plan protocol header is invalid");
  }
  const token = record(plan.token, "settlement plan token");
  exactKeys(token, ["decimals", "mint", "symbol"], "settlement plan token");
  if (
    token.symbol !== "USDC" ||
    token.mint !== SOLANA_MAINNET_USDC_MINT ||
    token.decimals !== USDC_DECIMALS
  ) {
    throw new TypeError("Settlement plan token identity is invalid");
  }
  if (!Array.isArray(plan.transfers)) {
    throw new TypeError("Settlement plan transfers must be an array");
  }
  const expected = createSettlementExecutionPlan({
    allocation,
    allocationSha256:
      typeof plan.allocationSha256 === "string" ? plan.allocationSha256 : "",
    createdAt: typeof plan.createdAt === "string" ? plan.createdAt : "",
    feeRecipient: (
      plan.transfers.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).kind === "platform-fee",
      ) as Record<string, unknown> | undefined
    )?.recipientOwner as string,
    sourceOwner: typeof plan.sourceOwner === "string" ? plan.sourceOwner : "",
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new TypeError("Settlement plan differs from its approved allocation");
  }
  const totals = record(plan.totals, "settlement plan totals");
  minor(totals.contributorMinor, "settlement plan totals.contributorMinor");
  minor(totals.platformFeeMinor, "settlement plan totals.platformFeeMinor");
  minor(totals.totalMinor, "settlement plan totals.totalMinor");
  return expected;
}

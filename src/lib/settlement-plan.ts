/**
 * Builds and validates unsigned USDC transfer plans from approved payout
 * intents. A cycle settles on the one network frozen in its allocation: Solana
 * plans use the SPL mint, Base plans use the Base USDC
 * contract and EIP-681 requests. Plans contain public addresses and exact
 * integer amounts only; no signer, seed phrase, private key, or optimistic
 * payment state is accepted.
 */

import { fundingInstrumentId } from "./allocation-funding-basis.mjs";
import {
  EVM_FUNDING_CHAIN_IDS,
  EVM_FUNDING_USDC_CONTRACTS,
} from "./evm-funding";
import type { FundingCommitmentInstrument } from "./funding-instruments.mjs";
import { findProject } from "./projects.mjs";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
  type SettlementNetwork,
} from "./rewards";
import { isBaseAddress, isSolanaAddress } from "./wallets";

export const SETTLEMENT_PLAN_SCHEMA_VERSION = "1" as const;
export const SOLANA_MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;
export const BASE_MAINNET_CHAIN_ID = Number(EVM_FUNDING_CHAIN_IDS.base);
export const BASE_MAINNET_USDC_CONTRACT = EVM_FUNDING_USDC_CONTRACTS.base;
export const USDC_DECIMALS = 6 as const;
export const MAX_TRANSFERS_PER_PLAN = 200;
export const PROJECT_VAULT_INSTRUMENT_PREFIX = "squads-project-vault:solana:";

/**
 * RFC #500 section 8. A 2-of-2 vault pays the platform fee from the vault, so
 * its plan ends with a fee transfer. A project vault holds contributor
 * principal only: the creator sends the fee as a separate transfer from the
 * creator's own wallet, so the plan carries no fee transfer, reports
 * `platformFeeMinor: "0"`, and nothing Slop votes on can pay Slop. The fee
 * due stays `allocation.totals.feeMinor` and is reconciled at settlement.
 */
export function planCarriesPlatformFee(instrumentId: unknown): boolean {
  return !(
    typeof instrumentId === "string" &&
    instrumentId.startsWith(PROJECT_VAULT_INSTRUMENT_PREFIX)
  );
}

/** The frozen funding-basis identity of a reviewed Squads instrument of either
 * kind. Every ledger that names an instrument uses this exact string. */
export function squadsInstrumentId(instrument: {
  kind: "squads-v4-vault" | "squads-project-vault";
  multisig: string;
  vaultIndex: number;
  vault: string;
}): string {
  return `${instrument.kind}:solana:${instrument.multisig}:${instrument.vaultIndex}:${instrument.vault}`;
}

export interface SettlementPlanTransfer {
  paymentId: string;
  kind: "contributor" | "platform-fee";
  intentIds: string[];
  recipientOwner: string;
  amountMinor: string;
  rewardLines?: {
    sharedPoolMinor: string;
    reviewBudgetMinor: string;
  };
}

interface SettlementPlanBody {
  schemaVersion: typeof SETTLEMENT_PLAN_SCHEMA_VERSION;
  status: "unsigned";
  projectId: string;
  cycleId: string;
  createdAt: string;
  allocationSha256: string;
  sourceOwner: string;
  transfers: SettlementPlanTransfer[];
  totals: {
    contributorMinor: string;
    platformFeeMinor: string;
    totalMinor: string;
  };
}

/** The Solana plan. Squads execution tooling consumes this exact shape. */
export interface SettlementExecutionPlan extends SettlementPlanBody {
  kind: "solana-usdc-transfer-plan";
  cluster: "mainnet-beta";
  token: {
    symbol: "USDC";
    mint: typeof SOLANA_MAINNET_USDC_MINT;
    decimals: typeof USDC_DECIMALS;
  };
}

/** The Base plan: ordinary ERC-20 transfers the creator signs externally. */
export interface BaseSettlementExecutionPlan extends SettlementPlanBody {
  kind: "base-usdc-transfer-plan";
  chainId: typeof BASE_MAINNET_CHAIN_ID;
  token: {
    symbol: "USDC";
    contract: typeof BASE_MAINNET_USDC_CONTRACT;
    decimals: typeof USDC_DECIMALS;
  };
}

export type NetworkSettlementExecutionPlan =
  | SettlementExecutionPlan
  | BaseSettlementExecutionPlan;

interface PlanInput {
  allocation: unknown;
  allocationSha256: string;
  createdAt: string;
  feeRecipient: string;
  sourceOwner: string;
}

const NETWORK_LABEL: Record<SettlementNetwork, string> = {
  base: "Base address",
  solana: "Solana public key",
};

function assertPlannedTransfer(
  plan: NetworkSettlementExecutionPlan,
  transfer: SettlementPlanTransfer,
): void {
  if (
    !plan.transfers.some(
      (candidate) =>
        candidate.paymentId === transfer.paymentId &&
        candidate.recipientOwner === transfer.recipientOwner &&
        candidate.amountMinor === transfer.amountMinor,
    )
  ) {
    throw new TypeError("Payment request transfer is not in the mainnet plan");
  }
}

/**
 * Creates the standard EIP-681 request for one Base plan transfer: a call to
 * the Base USDC contract's `transfer(address,uint256)` with the exact integer
 * amount. The request carries no memo, so payment is proven only by verified
 * Transfer deltas, never by the request itself.
 */
export function createEip681TransferRequest(
  plan: BaseSettlementExecutionPlan,
  transfer: SettlementPlanTransfer,
): string {
  if (
    plan.chainId !== BASE_MAINNET_CHAIN_ID ||
    plan.token.contract !== BASE_MAINNET_USDC_CONTRACT ||
    plan.token.decimals !== USDC_DECIMALS
  ) {
    throw new TypeError("Payment request transfer is not in the mainnet plan");
  }
  assertPlannedTransfer(plan, transfer);
  const recipient = address("base", transfer.recipientOwner, "recipientOwner");
  const amount = minor(transfer.amountMinor, "payment request amountMinor");
  return `ethereum:${BASE_MAINNET_USDC_CONTRACT}@${BASE_MAINNET_CHAIN_ID}/transfer?address=${recipient}&uint256=${amount}`;
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

function address(
  network: SettlementNetwork,
  value: string,
  field: string,
): string {
  const valid =
    network === "base" ? isBaseAddress(value) : isSolanaAddress(value);
  if (!valid) {
    throw new TypeError(`${field} must be a ${NETWORK_LABEL[network]}`);
  }
  return value;
}

/** Shared network-independent body: one transfer per approved intent plus the fee. */
function createPlanBody(
  allocation: RewardAllocationManifest,
  input: PlanInput,
  network: SettlementNetwork,
): SettlementPlanBody {
  if (!/^[0-9a-f]{64}$/u.test(input.allocationSha256)) {
    throw new TypeError("Settlement allocation digest is invalid");
  }
  const sourceOwner = address(network, input.sourceOwner, "sourceOwner");
  const carriesFee = planCarriesPlatformFee(
    allocation.fundingBasis?.instrumentId,
  );
  const approved = allocation.allocations.filter(
    (row) => row.state === "approved",
  );
  if (approved.length === 0) {
    throw new RangeError("Approved allocation contains no payable intents");
  }
  if (approved.length + (carriesFee ? 1 : 0) > MAX_TRANSFERS_PER_PLAN) {
    throw new RangeError("Settlement exceeds the bounded transfer-plan limit");
  }
  const transfers: SettlementPlanTransfer[] = approved.map((row) => {
    if (!row.wallet) throw new TypeError(`${row.intentId} has no wallet`);
    const recipientOwner = address(
      network,
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
      ...(row.lines
        ? {
            rewardLines: {
              sharedPoolMinor: row.lines.sharedPool.approvedMinor,
              reviewBudgetMinor: row.lines.reviewBudget.approvedMinor,
            },
          }
        : {}),
    };
  });
  const platformFeeMinor = carriesFee ? allocation.totals.feeMinor : "0";
  if (BigInt(platformFeeMinor) > 0n) {
    const feeRecipient = address(network, input.feeRecipient, "feeRecipient");
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
    status: "unsigned",
    projectId: allocation.projectId,
    cycleId: allocation.cycleId,
    createdAt: exactUtc(input.createdAt),
    allocationSha256: input.allocationSha256,
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

function approvedAllocation(
  value: unknown,
  network: SettlementNetwork,
): RewardAllocationManifest {
  const allocation = assertRewardAllocationManifest(value);
  if (allocation.status !== "approved") {
    throw new TypeError("Settlement requires an approved allocation manifest");
  }
  if (allocation.chain !== network) {
    throw new TypeError(
      `Allocation settles on ${allocation.chain}, not ${network}`,
    );
  }
  return allocation;
}

/** Creates the exact unsigned Solana transfers an external creator wallet must sign. */
export function createSettlementExecutionPlan(
  input: PlanInput,
): SettlementExecutionPlan {
  const allocation = approvedAllocation(input.allocation, "solana");
  if (allocation.fundingBasis) {
    // The allocation validator has already checked the complete identity syntax.
    // A caller-supplied wallet cannot substitute for the frozen funding source.
    const instrumentId = allocation.fundingBasis.instrumentId;
    if (
      !instrumentId?.startsWith("squads-v4-vault:solana:") &&
      !instrumentId?.startsWith(PROJECT_VAULT_INSTRUMENT_PREFIX)
    ) {
      throw new TypeError(
        "Settlement requires a frozen Solana Squads funding instrument",
      );
    }
    const vault = instrumentId.split(":")[4];
    if (address("solana", input.sourceOwner, "sourceOwner") !== vault) {
      throw new TypeError(
        "Settlement source owner must match the frozen funding vault",
      );
    }
  }
  return {
    ...createPlanBody(allocation, input, "solana"),
    kind: "solana-usdc-transfer-plan",
    cluster: "mainnet-beta",
    token: {
      symbol: "USDC",
      mint: SOLANA_MAINNET_USDC_MINT,
      decimals: USDC_DECIMALS,
    },
  };
}

export function projectInstruments(
  projectId: string,
): readonly FundingCommitmentInstrument[] {
  return findProject(projectId)?.funding.commitments ?? [];
}

/**
 * Creates the exact unsigned Base transfers an external creator wallet must
 * sign. The source is the recipient of the frozen Sablier stream on Base, the
 * account that withdraws the committed funds; no other wallet substitutes.
 */
export function createBaseSettlementExecutionPlan(
  input: PlanInput & {
    fundingInstruments?: readonly FundingCommitmentInstrument[];
  },
): BaseSettlementExecutionPlan {
  const allocation = approvedAllocation(input.allocation, "base");
  const instrumentId = allocation.fundingBasis?.instrumentId;
  if (!instrumentId?.startsWith("sablier-lockup-v4:base:")) {
    throw new TypeError(
      "Base settlement requires a frozen Base Sablier funding instrument",
    );
  }
  const instrument = (
    input.fundingInstruments ?? projectInstruments(allocation.projectId)
  ).find(
    (candidate) =>
      candidate.kind === "sablier-lockup-v4" &&
      fundingInstrumentId(candidate) === instrumentId,
  );
  if (instrument?.kind !== "sablier-lockup-v4") {
    throw new TypeError(
      "Base settlement funding instrument is not in the project manifest",
    );
  }
  if (
    address("base", input.sourceOwner, "sourceOwner") !== instrument.recipient
  ) {
    throw new TypeError(
      "Settlement source owner must match the frozen stream recipient",
    );
  }
  return {
    ...createPlanBody(allocation, input, "base"),
    kind: "base-usdc-transfer-plan",
    chainId: BASE_MAINNET_CHAIN_ID,
    token: {
      symbol: "USDC",
      contract: BASE_MAINNET_USDC_CONTRACT,
      decimals: USDC_DECIMALS,
    },
  };
}

/** The account a reviewed instrument pays from: the Squads vault or the stream recipient. */
export function fundingInstrumentSource(
  instrument: FundingCommitmentInstrument,
): string {
  return instrument.kind === "sablier-lockup-v4"
    ? instrument.recipient
    : instrument.vault;
}

/**
 * Creates the unsigned plan on the allocation's frozen network, sourced from
 * the exact reviewed instrument. The caller never supplies the source wallet.
 */
export function createNetworkSettlementExecutionPlan(
  input: Omit<PlanInput, "sourceOwner"> & {
    instrument: FundingCommitmentInstrument;
  },
): NetworkSettlementExecutionPlan {
  const allocation = assertRewardAllocationManifest(input.allocation);
  const planInput = {
    allocation,
    allocationSha256: input.allocationSha256,
    createdAt: input.createdAt,
    feeRecipient: input.feeRecipient,
    sourceOwner: fundingInstrumentSource(input.instrument),
  };
  return allocation.chain === "base"
    ? createBaseSettlementExecutionPlan({
        ...planInput,
        fundingInstruments: [input.instrument],
      })
    : createSettlementExecutionPlan(planInput);
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

const PLAN_BODY_KEYS = [
  "allocationSha256",
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
] as const;

/** Reads the caller-independent inputs back out of a stored plan. */
function storedPlanInput(
  plan: Record<string, unknown>,
  allocation: RewardAllocationManifest,
): PlanInput {
  if (!Array.isArray(plan.transfers)) {
    throw new TypeError("Settlement plan transfers must be an array");
  }
  return {
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
  };
}

function assertPlanHeader(
  plan: Record<string, unknown>,
  allocation: RewardAllocationManifest,
  kind: NetworkSettlementExecutionPlan["kind"],
): void {
  if (
    plan.schemaVersion !== SETTLEMENT_PLAN_SCHEMA_VERSION ||
    plan.kind !== kind ||
    plan.status !== "unsigned" ||
    plan.projectId !== allocation.projectId ||
    plan.cycleId !== allocation.cycleId
  ) {
    throw new TypeError("Settlement plan protocol header is invalid");
  }
}

function assertMatchesExpected<Plan extends NetworkSettlementExecutionPlan>(
  plan: Record<string, unknown>,
  expected: Plan,
): Plan {
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new TypeError("Settlement plan differs from its approved allocation");
  }
  const totals = record(plan.totals, "settlement plan totals");
  minor(totals.contributorMinor, "settlement plan totals.contributorMinor");
  minor(totals.platformFeeMinor, "settlement plan totals.platformFeeMinor");
  minor(totals.totalMinor, "settlement plan totals.totalMinor");
  return expected;
}

/** Revalidates a Solana execution plan loaded from a public cycle file. */
export function assertSettlementExecutionPlan(
  value: unknown,
  allocation: RewardAllocationManifest,
): SettlementExecutionPlan {
  const plan = record(value, "settlement plan");
  exactKeys(plan, [...PLAN_BODY_KEYS, "cluster"], "settlement plan");
  assertPlanHeader(plan, allocation, "solana-usdc-transfer-plan");
  if (plan.cluster !== "mainnet-beta") {
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
  return assertMatchesExpected(
    plan,
    createSettlementExecutionPlan(storedPlanInput(plan, allocation)),
  );
}

/** Revalidates a Base execution plan loaded from a public cycle file. */
export function assertBaseSettlementExecutionPlan(
  value: unknown,
  allocation: RewardAllocationManifest,
  fundingInstruments: readonly FundingCommitmentInstrument[] = projectInstruments(
    allocation.projectId,
  ),
): BaseSettlementExecutionPlan {
  const plan = record(value, "settlement plan");
  exactKeys(plan, [...PLAN_BODY_KEYS, "chainId"], "settlement plan");
  assertPlanHeader(plan, allocation, "base-usdc-transfer-plan");
  if (plan.chainId !== BASE_MAINNET_CHAIN_ID) {
    throw new TypeError("Settlement plan protocol header is invalid");
  }
  const token = record(plan.token, "settlement plan token");
  exactKeys(token, ["contract", "decimals", "symbol"], "settlement plan token");
  if (
    token.symbol !== "USDC" ||
    token.contract !== BASE_MAINNET_USDC_CONTRACT ||
    token.decimals !== USDC_DECIMALS
  ) {
    throw new TypeError("Settlement plan token identity is invalid");
  }
  return assertMatchesExpected(
    plan,
    createBaseSettlementExecutionPlan({
      ...storedPlanInput(plan, allocation),
      fundingInstruments,
    }),
  );
}

/** Revalidates a stored plan on the network its allocation froze. */
export function assertNetworkSettlementExecutionPlan(
  value: unknown,
  allocation: RewardAllocationManifest,
  fundingInstruments?: readonly FundingCommitmentInstrument[],
): NetworkSettlementExecutionPlan {
  return allocation.chain === "base"
    ? assertBaseSettlementExecutionPlan(value, allocation, fundingInstruments)
    : assertSettlementExecutionPlan(value, allocation);
}

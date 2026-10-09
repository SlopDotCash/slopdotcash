/**
 * Verifies finalized Solana transactions by reconciling exact raw USDC balance
 * deltas for the declared source and recipients, and reconciles a stored cycle
 * settlement on the network its allocation froze. Transaction signatures and
 * hashes alone never count as payment evidence.
 */

import type { ExpectedEvmTransfer } from "./evm-settlement";
import { isSolanaTransactionId } from "./funding-address.mjs";
import type { FundingCommitmentInstrument } from "./funding-instruments.mjs";
import type {
  RewardAllocationManifest,
  RewardSettlementManifest,
} from "./rewards";
import {
  assertRewardAllocationManifest,
  assertRewardSettlementManifest,
} from "./rewards";
import {
  assertNetworkSettlementExecutionPlan,
  type NetworkSettlementExecutionPlan,
  planCarriesPlatformFee,
  projectInstruments,
  type SettlementPlanTransfer,
  SOLANA_MAINNET_USDC_MINT,
  squadsInstrumentId,
  USDC_DECIMALS,
} from "./settlement-plan";
import { isSolanaAddress } from "./wallets";

interface ExpectedTransfer {
  amountMinor: string;
  recipientOwner: string;
}

export interface VerifiedSolanaTransaction {
  blockTime: number;
  signature: string;
  slot: number;
}

/** One Base transaction proven under the RPC quorum and confirmation policy. */
export interface VerifiedBaseSettlementTransaction {
  blockTime: number;
  transactionHash: string;
}

/** Proves one Base transaction's exact source debit and recipient credits. */
export type VerifyBaseSettlementTransaction = (input: {
  source: string;
  transactionHash: string;
  transfers: readonly ExpectedEvmTransfer[];
}) => Promise<VerifiedBaseSettlementTransaction>;

export const SOLANA_FUNDING_VERIFIER_VERSION = "funding-solana-v1" as const;

/** Refuses an immutable settlement time earlier than its chain evidence. */
export function assertSettlementChronology<
  Transaction extends { blockTime: number },
>(settledAt: string, transactions: readonly Transaction[]): void {
  const settledAtMs = Date.parse(settledAt);
  if (!Number.isFinite(settledAtMs)) {
    throw new TypeError("Settlement time is invalid");
  }
  if (
    transactions.some(
      (transaction) => transaction.blockTime * 1_000 > settledAtMs,
    )
  ) {
    throw new TypeError("Settlement time predates its finalized transaction");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return Number(value);
}

function signature(value: unknown, field: string): string {
  if (!isSolanaTransactionId(value)) {
    throw new TypeError(`${field} is not a Solana signature`);
  }
  return value;
}

function tokenBalances(
  value: unknown,
  field: string,
): Map<number, { amount: bigint; mint: string; owner: string }> {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const result = new Map<
    number,
    { amount: bigint; mint: string; owner: string }
  >();
  value.forEach((entry, index) => {
    const balance = record(entry, `${field}[${index}]`);
    const accountIndex = safeInteger(
      balance.accountIndex,
      `${field}[${index}].accountIndex`,
    );
    if (result.has(accountIndex)) {
      throw new TypeError(`${field} repeats account index ${accountIndex}`);
    }
    if (
      typeof balance.mint !== "string" ||
      typeof balance.owner !== "string" ||
      !isSolanaAddress(balance.owner)
    ) {
      throw new TypeError(`${field}[${index}] has invalid token identity`);
    }
    const ui = record(
      balance.uiTokenAmount,
      `${field}[${index}].uiTokenAmount`,
    );
    if (
      ui.decimals !== USDC_DECIMALS ||
      typeof ui.amount !== "string" ||
      ui.amount.length > 40 ||
      !/^(?:0|[1-9]\d*)$/u.test(ui.amount)
    ) {
      throw new TypeError(`${field}[${index}] has invalid raw token amount`);
    }
    result.set(accountIndex, {
      amount: BigInt(ui.amount),
      mint: balance.mint,
      owner: balance.owner,
    });
  });
  return result;
}

/** Validates one finalized transaction against a closed set of transfers. */
export function assertFinalizedUsdcTransfer(
  transactionValue: unknown,
  expectedSignature: string,
  sourceOwner: string,
  transfers: readonly ExpectedTransfer[],
): VerifiedSolanaTransaction {
  signature(expectedSignature, "expected signature");
  if (!isSolanaAddress(sourceOwner)) {
    throw new TypeError("source owner is not a Solana public key");
  }
  if (transfers.length === 0) {
    throw new TypeError("transaction expectation has no transfers");
  }
  const expectedByOwner = new Map<string, bigint>();
  for (const [index, transfer] of transfers.entries()) {
    if (
      !isSolanaAddress(transfer.recipientOwner) ||
      transfer.recipientOwner === sourceOwner ||
      !/^[1-9]\d*$/u.test(transfer.amountMinor)
    ) {
      throw new TypeError(`expected transfer ${index} is invalid`);
    }
    expectedByOwner.set(
      transfer.recipientOwner,
      (expectedByOwner.get(transfer.recipientOwner) ?? 0n) +
        BigInt(transfer.amountMinor),
    );
  }

  const transaction = record(transactionValue, "Solana transaction");
  const meta = record(transaction.meta, "Solana transaction.meta");
  if (meta.err !== null) {
    throw new TypeError("Solana transaction did not execute successfully");
  }
  const envelope = record(
    transaction.transaction,
    "Solana transaction.transaction",
  );
  if (
    !Array.isArray(envelope.signatures) ||
    envelope.signatures[0] !== expectedSignature
  ) {
    throw new TypeError(
      "Solana transaction signature does not match the receipt",
    );
  }
  const pre = tokenBalances(meta.preTokenBalances, "preTokenBalances");
  const post = tokenBalances(meta.postTokenBalances, "postTokenBalances");
  const accountIndexes = new Set([...pre.keys(), ...post.keys()]);
  const deltas = new Map<string, bigint>();
  for (const accountIndex of accountIndexes) {
    const before = pre.get(accountIndex);
    const after = post.get(accountIndex);
    const identity = after ?? before;
    if (!identity || identity.mint !== SOLANA_MAINNET_USDC_MINT) continue;
    if (
      before &&
      after &&
      (before.mint !== after.mint || before.owner !== after.owner)
    ) {
      throw new TypeError("Solana token-account identity changed unexpectedly");
    }
    const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
    deltas.set(identity.owner, (deltas.get(identity.owner) ?? 0n) + delta);
  }
  const totalExpected = [...expectedByOwner.values()].reduce(
    (total, amount) => total + amount,
    0n,
  );
  if (deltas.get(sourceOwner) !== -totalExpected) {
    throw new TypeError("Solana source USDC debit is not exact");
  }
  for (const [owner, amount] of expectedByOwner) {
    if (deltas.get(owner) !== amount) {
      throw new TypeError(
        `Solana recipient ${owner} did not receive the exact amount`,
      );
    }
  }
  for (const [owner, delta] of deltas) {
    if (delta !== 0n && owner !== sourceOwner && !expectedByOwner.has(owner)) {
      throw new TypeError(
        "Solana transaction contains an undeclared USDC delta",
      );
    }
  }
  return {
    signature: expectedSignature,
    slot: safeInteger(transaction.slot, "Solana transaction.slot"),
    blockTime: safeInteger(
      transaction.blockTime,
      "Solana transaction.blockTime",
    ),
  };
}

/** Validates one finalized direct-funding credit. Without `requiredSender`
 * the sender is not trusted; with it, that wallet must be the only debited
 * USDC owner and must send the exact amount.
 * `excludedOwner` names a wallet whose USDC accounts cannot participate.
 * A zero net change can hide a top-up followed by a fee transfer, so project
 * vault fees require a separate transaction without the vault's accounts. */
export function assertFinalizedUsdcFundingTransfer(
  transactionValue: unknown,
  expectedSignature: string,
  recipientOwner: string,
  amountMinor: string,
  options: { excludedOwner?: string; requiredSender?: string } = {},
): VerifiedSolanaTransaction {
  signature(expectedSignature, "expected signature");
  if (
    !isSolanaAddress(recipientOwner) ||
    amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(amountMinor)
  ) {
    throw new TypeError("funding transfer expectation is invalid");
  }
  if (
    options.excludedOwner !== undefined &&
    (!isSolanaAddress(options.excludedOwner) ||
      options.excludedOwner === recipientOwner)
  ) {
    throw new TypeError("excluded owner must be a distinct Solana public key");
  }
  if (
    options.requiredSender !== undefined &&
    (!isSolanaAddress(options.requiredSender) ||
      options.requiredSender === recipientOwner ||
      options.requiredSender === options.excludedOwner)
  ) {
    throw new TypeError("required sender must be a distinct Solana public key");
  }
  const transaction = record(transactionValue, "Solana transaction");
  const meta = record(transaction.meta, "Solana transaction.meta");
  if (meta.err !== null) {
    throw new TypeError("Solana transaction did not execute successfully");
  }
  const envelope = record(
    transaction.transaction,
    "Solana transaction.transaction",
  );
  if (
    !Array.isArray(envelope.signatures) ||
    envelope.signatures[0] !== expectedSignature
  ) {
    throw new TypeError(
      "Solana transaction signature does not match the funding record",
    );
  }
  const pre = tokenBalances(meta.preTokenBalances, "preTokenBalances");
  const post = tokenBalances(meta.postTokenBalances, "postTokenBalances");
  const accountIndexes = new Set([...pre.keys(), ...post.keys()]);
  const deltas = new Map<string, bigint>();
  for (const accountIndex of accountIndexes) {
    const before = pre.get(accountIndex);
    const after = post.get(accountIndex);
    const identity = after ?? before;
    if (!identity || identity.mint !== SOLANA_MAINNET_USDC_MINT) continue;
    if (
      before &&
      after &&
      (before.mint !== after.mint || before.owner !== after.owner)
    ) {
      throw new TypeError("Solana token-account identity changed unexpectedly");
    }
    const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
    deltas.set(identity.owner, (deltas.get(identity.owner) ?? 0n) + delta);
  }
  const expected = BigInt(amountMinor);
  if (deltas.get(recipientOwner) !== expected) {
    throw new TypeError(
      "Solana funding recipient did not receive the exact amount",
    );
  }
  if (
    [...deltas.entries()].some(
      ([owner, delta]) => delta > 0n && owner !== recipientOwner,
    )
  ) {
    throw new TypeError("Solana funding transaction has an undeclared credit");
  }
  if (options.requiredSender !== undefined) {
    const debited = [...deltas.entries()].filter(([, delta]) => delta < 0n);
    if (
      debited.length !== 1 ||
      debited[0][0] !== options.requiredSender ||
      debited[0][1] !== -expected
    ) {
      throw new TypeError(
        "Solana funding transaction was not sent by the required payer",
      );
    }
  }
  const netDelta = [...deltas.values()].reduce(
    (total, delta) => total + delta,
    0n,
  );
  if (netDelta !== 0n) {
    throw new TypeError(
      "Solana funding transaction USDC deltas do not balance",
    );
  }
  if (
    options.excludedOwner !== undefined &&
    deltas.has(options.excludedOwner)
  ) {
    throw new TypeError(
      "Solana funding transaction includes USDC accounts of the excluded vault",
    );
  }
  return {
    signature: expectedSignature,
    slot: safeInteger(transaction.slot, "Solana transaction.slot"),
    blockTime: safeInteger(
      transaction.blockTime,
      "Solana transaction.blockTime",
    ),
  };
}

function contributorTransferByIntent(
  plan: NetworkSettlementExecutionPlan,
): Map<string, SettlementPlanTransfer> {
  return new Map(
    plan.transfers
      .filter((transfer) => transfer.kind === "contributor")
      .map((transfer) => [transfer.intentIds[0], transfer]),
  );
}

/**
 * Fetches and checks every finalized contributor and fee transaction on the
 * allocation's network. Solana reads one finalized transaction per signature;
 * Base proves each hash through the read-only quorum verifier. A Base request
 * carries no memo, so a Base transaction must also be confirmed after the plan
 * was created: an earlier transfer with equal amounts cannot be replayed.
 */
export async function verifyRewardSettlementOnchain(input: {
  allocation: unknown;
  expectedAllocationSha256: string;
  fundingInstruments?: readonly FundingCommitmentInstrument[];
  getTransaction?: (signature: string) => Promise<unknown>;
  plan: unknown;
  settlement: unknown;
  verifyBaseTransaction?: VerifyBaseSettlementTransaction;
}): Promise<
  Array<VerifiedSolanaTransaction | VerifiedBaseSettlementTransaction>
> {
  const allocation: RewardAllocationManifest = assertRewardAllocationManifest(
    input.allocation,
  );
  const plan = assertNetworkSettlementExecutionPlan(
    input.plan,
    allocation,
    input.fundingInstruments,
  );
  const { getTransaction, verifyBaseTransaction } = input;
  const verifyTransaction =
    plan.kind === "base-usdc-transfer-plan"
      ? async (
          transactionHash: string,
          transfers: readonly SettlementPlanTransfer[],
        ) => {
          if (!verifyBaseTransaction) {
            throw new TypeError("Base settlement needs the Base verifier");
          }
          const verified = await verifyBaseTransaction({
            source: plan.sourceOwner,
            transactionHash,
            transfers: transfers.map((transfer) => ({
              recipient: transfer.recipientOwner,
              amountMinor: transfer.amountMinor,
            })),
          });
          if (
            verified.transactionHash !== transactionHash ||
            !Number.isSafeInteger(verified.blockTime) ||
            verified.blockTime * 1_000 < Date.parse(plan.createdAt)
          ) {
            throw new TypeError(
              "Base settlement transaction predates its plan or differs from evidence",
            );
          }
          return verified;
        }
      : async (
          signature: string,
          transfers: readonly SettlementPlanTransfer[],
        ) => {
          if (!getTransaction) {
            throw new TypeError("Solana settlement needs the Solana reader");
          }
          return assertFinalizedUsdcTransfer(
            await getTransaction(signature),
            signature,
            plan.sourceOwner,
            transfers,
          );
        };
  const settlement: RewardSettlementManifest = assertRewardSettlementManifest(
    input.settlement,
    allocation,
  );
  if (
    plan.allocationSha256 !== input.expectedAllocationSha256 ||
    settlement.allocationSha256 !== input.expectedAllocationSha256
  ) {
    throw new TypeError(
      "Settlement does not bind to the allocation file bytes",
    );
  }
  const byIntent = contributorTransferByIntent(plan);
  const verified: Array<
    VerifiedSolanaTransaction | VerifiedBaseSettlementTransaction
  > = [];
  for (const attempt of settlement.attempts) {
    if (attempt.state !== "finalized" || !attempt.signature) continue;
    const transfers = attempt.intentIds.map((intentId) => {
      const transfer = byIntent.get(intentId);
      if (!transfer) {
        throw new TypeError(
          `Settlement attempt references unplanned intent ${intentId}`,
        );
      }
      return transfer;
    });
    verified.push(await verifyTransaction(attempt.signature, transfers));
  }
  if (
    settlement.platformFee.state === "paid" ||
    settlement.platformFee.state === "reported"
  ) {
    const transfer = plan.transfers.find(
      (candidate) => candidate.kind === "platform-fee",
    );
    const feeSignature = settlement.platformFee.signature;
    if (transfer && feeSignature) {
      verified.push(await verifyTransaction(feeSignature, [transfer]));
    } else if (
      feeSignature &&
      getTransaction &&
      plan.kind === "solana-usdc-transfer-plan" &&
      !planCarriesPlatformFee(allocation.fundingBasis?.instrumentId)
    ) {
      // RFC #500 section 8: on a project vault the fee is a separate transfer
      // from the creator seat wallet (the reviewed instrument's creatorMember).
      // That wallet must be the only debited USDC owner, the transfer must
      // credit the reviewed fee recipient exactly, must not move the vault's
      // USDC at all, and becomes payable only once the contributor payout is
      // complete, so it cannot predate any finalized contributor transaction.
      if (!settlement.platformFee.recipient) {
        throw new TypeError("Project vault fee has no reviewed recipient");
      }
      const instrument = (
        input.fundingInstruments ?? projectInstruments(allocation.projectId)
      ).find(
        (candidate) =>
          candidate.kind === "squads-project-vault" &&
          squadsInstrumentId(candidate) ===
            allocation.fundingBasis?.instrumentId,
      );
      if (instrument?.kind !== "squads-project-vault") {
        throw new TypeError("Project vault fee has no reviewed instrument");
      }
      const fee = assertFinalizedUsdcFundingTransfer(
        await getTransaction(feeSignature),
        feeSignature,
        settlement.platformFee.recipient,
        settlement.platformFee.dueMinor,
        {
          excludedOwner: plan.sourceOwner,
          requiredSender: instrument.creatorMember,
        },
      );
      if (verified.some((payout) => payout.blockTime > fee.blockTime)) {
        throw new TypeError(
          "Project vault fee was sent before the contributor payout completed",
        );
      }
      verified.push(fee);
    } else {
      throw new TypeError("Reported platform fee has no planned transaction");
    }
  }
  assertSettlementChronology(settlement.settledAt, verified);
  return verified;
}

/** A settlement transaction can satisfy only one frozen cycle. A Base
 * transfer has no intent memo, and a project-vault fee has no memo either, so
 * every recorded signature on every network must be unique across cycles. */
export function assertDistinctSettlementTransactions(
  settlements: readonly RewardSettlementManifest[],
): void {
  const owners = new Map<string, string>();
  for (const settlement of settlements) {
    const owner = `${settlement.projectId}/${settlement.cycleId}`;
    const signatures = settlement.attempts
      .filter((attempt) => attempt.state === "finalized")
      .map((attempt) => attempt.signature);
    if (
      settlement.platformFee.state === "paid" ||
      settlement.platformFee.state === "reported"
    ) {
      signatures.push(settlement.platformFee.signature);
    }
    for (const signature of signatures) {
      if (!signature) continue;
      const key =
        settlement.chain === "base" ? signature.toLowerCase() : signature;
      const prior = owners.get(key);
      if (prior && prior !== owner) {
        throw new TypeError(
          `Settlement transaction ${signature} already consumed by ${prior}`,
        );
      }
      owners.set(key, owner);
    }
  }
}

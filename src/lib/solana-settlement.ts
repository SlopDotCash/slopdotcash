/**
 * Verifies finalized Solana transactions by reconciling exact raw USDC balance
 * deltas for the declared source and recipients. Transaction signatures alone
 * never count as payment evidence.
 */

import type {
  RewardAllocationManifest,
  RewardSettlementManifest,
} from "./rewards";
import {
  assertRewardAllocationManifest,
  assertRewardSettlementManifest,
} from "./rewards";
import {
  assertSettlementExecutionPlan,
  type SettlementExecutionPlan,
  type SettlementPlanTransfer,
  SOLANA_MAINNET_USDC_MINT,
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

export const SOLANA_FUNDING_VERIFIER_VERSION = "funding-solana-v1" as const;

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
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 128 ||
    !/^[1-9A-HJ-NP-Za-km-z]+$/u.test(value)
  ) {
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
    !envelope.signatures.some((value) => value === expectedSignature)
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

/** Validates one finalized direct-funding credit without trusting its sender. */
export function assertFinalizedUsdcFundingTransfer(
  transactionValue: unknown,
  expectedSignature: string,
  recipientOwner: string,
  amountMinor: string,
): VerifiedSolanaTransaction {
  signature(expectedSignature, "expected signature");
  if (
    !isSolanaAddress(recipientOwner) ||
    amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(amountMinor)
  ) {
    throw new TypeError("funding transfer expectation is invalid");
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
    !envelope.signatures.some((value) => value === expectedSignature)
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
  const netDelta = [...deltas.values()].reduce(
    (total, delta) => total + delta,
    0n,
  );
  if (netDelta !== 0n) {
    throw new TypeError(
      "Solana funding transaction USDC deltas do not balance",
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
  plan: SettlementExecutionPlan,
): Map<string, SettlementPlanTransfer> {
  return new Map(
    plan.transfers
      .filter((transfer) => transfer.kind === "contributor")
      .map((transfer) => [transfer.intentIds[0], transfer]),
  );
}

/** Fetches and checks every finalized contributor and fee transaction. */
export async function verifyRewardSettlementOnchain(input: {
  allocation: unknown;
  expectedAllocationSha256: string;
  getTransaction: (signature: string) => Promise<unknown>;
  plan: unknown;
  settlement: unknown;
}): Promise<VerifiedSolanaTransaction[]> {
  const allocation: RewardAllocationManifest = assertRewardAllocationManifest(
    input.allocation,
  );
  const plan = assertSettlementExecutionPlan(input.plan, allocation);
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
  const verified: VerifiedSolanaTransaction[] = [];
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
    verified.push(
      assertFinalizedUsdcTransfer(
        await input.getTransaction(attempt.signature),
        attempt.signature,
        plan.sourceOwner,
        transfers,
      ),
    );
  }
  if (
    settlement.platformFee.state === "paid" ||
    settlement.platformFee.state === "reported"
  ) {
    const transfer = plan.transfers.find(
      (candidate) => candidate.kind === "platform-fee",
    );
    if (!transfer || !settlement.platformFee.signature) {
      throw new TypeError("Reported platform fee has no planned transaction");
    }
    verified.push(
      assertFinalizedUsdcTransfer(
        await input.getTransaction(settlement.platformFee.signature),
        settlement.platformFee.signature,
        plan.sourceOwner,
        [transfer],
      ),
    );
  }
  return verified;
}

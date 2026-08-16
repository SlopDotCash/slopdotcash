/**
 * Verifies confirmed Bitcoin mainnet direct-funding credits from Esplora
 * transaction data by reconciling exact UTXO output sums, coherent fees, the
 * standard dust floor, and best-chain membership at check time. A transaction
 * id alone never counts as evidence.
 */

import { isFundingAddress } from "./funding-address.mjs";

export const BITCOIN_FUNDING_VERIFIER_VERSION = "funding-bitcoin-v1" as const;

export const BITCOIN_FUNDING_MIN_CONFIRMATIONS = 6;

/** Outputs at or below the standard 546-satoshi dust bound are not funding. */
export const BITCOIN_FUNDING_DUST_MINIMUM_SATS = 546n;

const MAX_SATS = 2_100_000_000_000_000n;
const MAX_TRANSACTION_IO = 10_000;

export interface VerifiedBitcoinTransaction {
  blockHash: string;
  blockHeight: number;
  confirmations: number;
  transactionId: string;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function isBitcoinTransactionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{64}$/u.test(value) &&
    !value.startsWith("0x")
  );
}

export function isBitcoinBlockHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function satoshis(value: unknown, field: string): bigint {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    BigInt(value) > MAX_SATS
  ) {
    throw new TypeError(`${field} must be a bounded satoshi integer`);
  }
  return BigInt(value);
}

function blockHeight(value: unknown, field: string): bigint {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 100_000_000
  ) {
    throw new TypeError(`${field} must be a bounded block height`);
  }
  return BigInt(value);
}

/** Validates one confirmed direct-funding credit without trusting its sender. */
export function assertConfirmedBtcFundingTransfer(
  transactionValue: unknown,
  expectedTransactionId: string,
  recipient: string,
  amountMinor: string,
  tipHeight: unknown,
  bestChainHashAtHeight: unknown,
): VerifiedBitcoinTransaction {
  if (
    !isBitcoinTransactionId(expectedTransactionId) ||
    !isFundingAddress("bitcoin", recipient) ||
    amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(amountMinor)
  ) {
    throw new TypeError("funding transfer expectation is invalid");
  }
  const expected = BigInt(amountMinor);
  if (expected < BITCOIN_FUNDING_DUST_MINIMUM_SATS) {
    throw new TypeError(
      "Bitcoin funding amount is at or below the standard dust bound",
    );
  }
  if (expected > MAX_SATS) {
    throw new TypeError("Bitcoin funding amount exceeds the satoshi supply");
  }
  const tip = blockHeight(tipHeight, "Bitcoin tip height");
  const transaction = record(transactionValue, "Bitcoin transaction");
  if (transaction.txid !== expectedTransactionId) {
    throw new TypeError(
      "Bitcoin transaction id does not match the funding record",
    );
  }
  const status = record(transaction.status, "Bitcoin transaction.status");
  if (status.confirmed !== true) {
    throw new TypeError("Bitcoin transaction is unconfirmed");
  }
  const height = blockHeight(
    status.block_height,
    "Bitcoin transaction.status.block_height",
  );
  if (!isBitcoinBlockHash(status.block_hash)) {
    throw new TypeError("Bitcoin transaction block hash is invalid");
  }
  if (
    !isBitcoinBlockHash(bestChainHashAtHeight) ||
    bestChainHashAtHeight !== status.block_hash
  ) {
    throw new TypeError(
      "Bitcoin transaction block is not in the current best chain",
    );
  }
  if (height > tip) {
    throw new TypeError("Bitcoin transaction height is beyond the chain tip");
  }
  const confirmations = tip - height + 1n;
  if (confirmations < BigInt(BITCOIN_FUNDING_MIN_CONFIRMATIONS)) {
    throw new TypeError(
      "Bitcoin transaction does not meet the network finality policy",
    );
  }
  const inputs = transaction.vin;
  const outputs = transaction.vout;
  if (
    !Array.isArray(inputs) ||
    !Array.isArray(outputs) ||
    inputs.length === 0 ||
    outputs.length === 0 ||
    inputs.length > MAX_TRANSACTION_IO ||
    outputs.length > MAX_TRANSACTION_IO
  ) {
    throw new TypeError("Bitcoin transaction inputs or outputs are invalid");
  }
  let inputTotal = 0n;
  inputs.forEach((entry, index) => {
    const input = record(entry, `Bitcoin vin[${index}]`);
    if (input.is_coinbase === true) {
      throw new TypeError("Bitcoin funding cannot come from a coinbase");
    }
    const prevout = record(input.prevout, `Bitcoin vin[${index}].prevout`);
    if (prevout.scriptpubkey_address === recipient) {
      throw new TypeError(
        "Bitcoin funding transaction spends the recipient's own coins",
      );
    }
    inputTotal += satoshis(
      prevout.value,
      `Bitcoin vin[${index}].prevout.value`,
    );
    if (inputTotal > MAX_SATS) {
      throw new TypeError(
        "Bitcoin transaction input total exceeds the satoshi supply",
      );
    }
  });
  let outputTotal = 0n;
  let recipientCredit = 0n;
  outputs.forEach((entry, index) => {
    const output = record(entry, `Bitcoin vout[${index}]`);
    const value = satoshis(output.value, `Bitcoin vout[${index}].value`);
    outputTotal += value;
    if (outputTotal > MAX_SATS) {
      throw new TypeError(
        "Bitcoin transaction output total exceeds the satoshi supply",
      );
    }
    if (output.scriptpubkey_address === recipient) {
      if (value <= BITCOIN_FUNDING_DUST_MINIMUM_SATS) {
        throw new TypeError(
          "Bitcoin funding credit includes a dust-level output",
        );
      }
      recipientCredit += value;
    }
  });
  const fee = satoshis(transaction.fee, "Bitcoin transaction.fee");
  if (fee === 0n || inputTotal !== outputTotal + fee) {
    throw new TypeError(
      "Bitcoin transaction fee does not reconcile inputs and outputs",
    );
  }
  if (recipientCredit !== expected) {
    throw new TypeError(
      "Bitcoin funding recipient did not receive the exact amount",
    );
  }
  return {
    transactionId: expectedTransactionId,
    blockHash: status.block_hash as string,
    blockHeight: Number(height),
    confirmations: Number(confirmations),
  };
}

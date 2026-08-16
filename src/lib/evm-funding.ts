/**
 * Verifies confirmed Base and Ethereum mainnet USDC direct-funding credits by
 * reconciling exact ERC-20 Transfer deltas from a successful receipt against a
 * finalized chain head. A transaction hash alone never counts as evidence.
 */

export type EvmFundingNetwork = "base" | "ethereum";

export const EVM_FUNDING_VERIFIER_VERSIONS = {
  base: "funding-base-v1",
  ethereum: "funding-ethereum-v1",
} as const;

export const EVM_FUNDING_USDC_CONTRACTS = {
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
} as const;

export const EVM_FUNDING_CHAIN_IDS = { base: 8453n, ethereum: 1n } as const;

export const EVM_FUNDING_MIN_CONFIRMATIONS = {
  base: 12,
  ethereum: 64,
} as const;

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_EVM_ADDRESS = `0x${"0".repeat(40)}`;

export interface VerifiedEvmTransaction {
  blockNumber: number;
  confirmations: number;
  transactionHash: string;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function isEvmFundingNetwork(
  value: unknown,
): value is EvmFundingNetwork {
  return value === "base" || value === "ethereum";
}

export function isEvmTransactionHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value);
}

/** Parses a canonical EVM JSON-RPC hex quantity into a bounded bigint. */
export function evmQuantity(value: unknown, field: string): bigint {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) {
    throw new TypeError(`${field} is not a canonical EVM hex quantity`);
  }
  return BigInt(value);
}

function topicAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${field} is not an ABI-encoded EVM address topic`);
  }
  return `0x${value.slice(26)}`;
}

function transferValue(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${field} is not an ABI-encoded ERC-20 value`);
  }
  return BigInt(value);
}

/** Validates one confirmed direct-funding credit without trusting its sender. */
export function assertConfirmedUsdcFundingTransfer(
  receiptValue: unknown,
  network: EvmFundingNetwork,
  expectedTransactionHash: string,
  recipient: string,
  amountMinor: string,
  finalizedBlockNumber: bigint,
): VerifiedEvmTransaction {
  if (!isEvmFundingNetwork(network)) {
    throw new TypeError("funding network must be base or ethereum");
  }
  if (
    !isEvmTransactionHash(expectedTransactionHash) ||
    typeof recipient !== "string" ||
    !/^0x[0-9a-f]{40}$/u.test(recipient) ||
    recipient === ZERO_EVM_ADDRESS ||
    amountMinor.length > 40 ||
    !/^[1-9]\d*$/u.test(amountMinor)
  ) {
    throw new TypeError("funding transfer expectation is invalid");
  }
  if (
    finalizedBlockNumber < 0n ||
    finalizedBlockNumber > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("finalized block number is invalid");
  }
  const receipt = record(receiptValue, "EVM transaction receipt");
  if (receipt.status !== "0x1") {
    throw new TypeError("EVM transaction did not execute successfully");
  }
  if (receipt.transactionHash !== expectedTransactionHash) {
    throw new TypeError(
      "EVM receipt transaction hash does not match the funding record",
    );
  }
  const blockNumber = evmQuantity(receipt.blockNumber, "receipt.blockNumber");
  if (blockNumber > finalizedBlockNumber) {
    throw new TypeError("EVM transaction block is not finalized yet");
  }
  const confirmations = finalizedBlockNumber - blockNumber + 1n;
  const minimum = BigInt(EVM_FUNDING_MIN_CONFIRMATIONS[network]);
  if (confirmations < minimum) {
    throw new TypeError(
      "EVM transaction does not meet the network finality policy",
    );
  }
  if (!Array.isArray(receipt.logs)) {
    throw new TypeError("EVM receipt logs must be an array");
  }
  const usdcContract = EVM_FUNDING_USDC_CONTRACTS[network];
  const deltas = new Map<string, bigint>();
  receipt.logs.forEach((entry, index) => {
    const log = record(entry, `receipt.logs[${index}]`);
    if (log.removed === true) {
      throw new TypeError("EVM receipt contains a reorged log");
    }
    if (
      typeof log.address !== "string" ||
      log.address.toLowerCase() !== usdcContract
    ) {
      return;
    }
    if (!Array.isArray(log.topics) || log.topics.length === 0) {
      throw new TypeError(`receipt.logs[${index}] has no event topics`);
    }
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) return;
    if (log.topics.length !== 3) {
      throw new TypeError(
        `receipt.logs[${index}] is not a canonical ERC-20 Transfer`,
      );
    }
    const from = topicAddress(log.topics[1], `receipt.logs[${index}].from`);
    const to = topicAddress(log.topics[2], `receipt.logs[${index}].to`);
    if (from === ZERO_EVM_ADDRESS || to === ZERO_EVM_ADDRESS) {
      throw new TypeError(
        "EVM funding transaction mints or burns USDC instead of transferring",
      );
    }
    const value = transferValue(log.data, `receipt.logs[${index}].data`);
    deltas.set(to, (deltas.get(to) ?? 0n) + value);
    deltas.set(from, (deltas.get(from) ?? 0n) - value);
  });
  const expected = BigInt(amountMinor);
  if (deltas.get(recipient) !== expected) {
    throw new TypeError(
      "EVM funding recipient did not receive the exact amount",
    );
  }
  if (
    [...deltas.entries()].some(
      ([owner, delta]) => delta > 0n && owner !== recipient,
    )
  ) {
    throw new TypeError("EVM funding transaction has an undeclared credit");
  }
  const netDelta = [...deltas.values()].reduce(
    (total, delta) => total + delta,
    0n,
  );
  if (netDelta !== 0n) {
    throw new TypeError("EVM funding transaction USDC deltas do not balance");
  }
  return {
    transactionHash: expectedTransactionHash,
    blockNumber: Number(blockNumber),
    confirmations: Number(confirmations),
  };
}

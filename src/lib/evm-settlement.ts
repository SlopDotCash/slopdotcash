/**
 * Verifies confirmed Base mainnet USDC payouts by reconciling exact ERC-20
 * Transfer deltas for the declared source and recipients. A transaction hash
 * alone never counts as payment evidence, and nothing here plans, signs, or
 * records a payment.
 */

import {
  assertConfirmedUsdcDeltas,
  type EvmCanonicalBlock,
  isEvmTransactionHash,
  type VerifiedEvmTransaction,
} from "./evm-funding";

export type EvmSettlementNetwork = "base";

export const EVM_SETTLEMENT_VERIFIER_VERSION = "settlement-base-v1" as const;

export const MAX_EVM_SETTLEMENT_TRANSFERS = 200;

export interface ExpectedEvmTransfer {
  amountMinor: string;
  recipient: string;
}

export function isEvmSettlementNetwork(
  value: unknown,
): value is EvmSettlementNetwork {
  return value === "base";
}

function isEvmAccount(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^0x[0-9a-f]{40}$/u.test(value) &&
    !/^0x0{40}$/u.test(value)
  );
}

/**
 * Validates one confirmed transaction against a closed set of transfers. One
 * receipt may carry a single transfer or a smart-account batch; either way the
 * source debit, every recipient credit, and the absence of any other USDC
 * movement must reconcile exactly.
 */
export function assertConfirmedUsdcSettlementTransfer(
  receiptValue: unknown,
  network: EvmSettlementNetwork,
  expectedTransactionHash: string,
  source: string,
  transfers: readonly ExpectedEvmTransfer[],
  finalizedBlock: EvmCanonicalBlock,
  receiptBlock: EvmCanonicalBlock,
): VerifiedEvmTransaction {
  if (!isEvmSettlementNetwork(network)) {
    throw new TypeError("settlement network must be base");
  }
  if (!isEvmTransactionHash(expectedTransactionHash)) {
    throw new TypeError("expected transaction hash is not canonical");
  }
  if (!isEvmAccount(source)) {
    throw new TypeError("source is not a canonical EVM address");
  }
  if (
    transfers.length === 0 ||
    transfers.length > MAX_EVM_SETTLEMENT_TRANSFERS
  ) {
    throw new TypeError(
      `transaction expectation must hold 1 to ${MAX_EVM_SETTLEMENT_TRANSFERS} transfers`,
    );
  }
  const expectedByRecipient = new Map<string, bigint>();
  for (const [index, transfer] of transfers.entries()) {
    if (
      !isEvmAccount(transfer.recipient) ||
      transfer.recipient === source ||
      typeof transfer.amountMinor !== "string" ||
      transfer.amountMinor.length > 40 ||
      !/^[1-9]\d*$/u.test(transfer.amountMinor)
    ) {
      throw new TypeError(`expected transfer ${index} is invalid`);
    }
    expectedByRecipient.set(
      transfer.recipient,
      (expectedByRecipient.get(transfer.recipient) ?? 0n) +
        BigInt(transfer.amountMinor),
    );
  }
  const { deltas, verified } = assertConfirmedUsdcDeltas(
    receiptValue,
    network,
    expectedTransactionHash,
    finalizedBlock,
    receiptBlock,
    "settlement",
  );
  const totalExpected = [...expectedByRecipient.values()].reduce(
    (total, amount) => total + amount,
    0n,
  );
  if (deltas.get(source) !== -totalExpected) {
    throw new TypeError("EVM source USDC debit is not exact");
  }
  for (const [recipient, amount] of expectedByRecipient) {
    if (deltas.get(recipient) !== amount) {
      throw new TypeError(
        `EVM recipient ${recipient} did not receive the exact amount`,
      );
    }
  }
  for (const [account, delta] of deltas) {
    if (
      delta !== 0n &&
      account !== source &&
      !expectedByRecipient.has(account)
    ) {
      throw new TypeError("EVM transaction contains an undeclared USDC delta");
    }
  }
  return verified;
}

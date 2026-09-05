/**
 * Read-only assertions for a Sablier Lockup v4 USDC stream commitment on Base
 * or Ethereum. The stream is a third-party, non-upgradeable smart contract
 * that Slop does not control; these checks parse finalized `eth_call`
 * evidence and never read a key, sign, broadcast, or claim custody.
 */

import { isFundingAddress } from "./funding-address.mjs";
import type { SABLIER_LOCKUP_V4_CONTRACTS } from "./funding-instruments.mjs";

export { SABLIER_LOCKUP_V4_CONTRACTS } from "./funding-instruments.mjs";

export const COMMITMENT_SABLIER_VERIFIER_VERSION =
  "commitment-sablier-v2" as const;

export type SablierNetwork = keyof typeof SABLIER_LOCKUP_V4_CONTRACTS;

/** Canonical Circle-issued USDC token contracts; the only accepted assets. */
export const EVM_FUNDING_USDC_CONTRACTS = Object.freeze({
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
} as const satisfies Record<SablierNetwork, string>);

/**
 * Author-time 4-byte selectors for the Sablier Lockup v4 view functions
 * (`ISablierLockup` / `ISablierLockupState` at tag `lockup@v4.0.1`). Lockup
 * v4 renamed the v1 `getAsset(uint256)` getter to
 * `getUnderlyingToken(uint256)`; there is no `getAsset` in v4.
 */
export const SABLIER_STREAM_SELECTORS = Object.freeze({
  /** keccak256("getUnderlyingToken(uint256)")[0..4] */
  underlyingToken: "0xa4775772",
  /** keccak256("getRecipient(uint256)")[0..4] */
  recipient: "0x6d0cee75",
  /** keccak256("getSender(uint256)")[0..4] */
  sender: "0xb971302a",
  /** keccak256("getDepositedAmount(uint256)")[0..4] */
  depositedAmount: "0xa80fc071",
  /** keccak256("getWithdrawnAmount(uint256)")[0..4] */
  withdrawnAmount: "0xd511609f",
  /** keccak256("getRefundedAmount(uint256)")[0..4] */
  refundedAmount: "0xd4dbd20b",
  /** keccak256("getEndTime(uint256)")[0..4] */
  endTime: "0x9067b677",
  /** keccak256("isCancelable(uint256)")[0..4] */
  isCancelable: "0x4857501f",
  /** keccak256("wasCanceled(uint256)")[0..4] */
  wasCanceled: "0xf590c176",
  /** keccak256("isDepleted(uint256)")[0..4] */
  isDepleted: "0x425d30dd",
} as const);

export type SablierStreamCall = keyof typeof SABLIER_STREAM_SELECTORS;

export type SablierStreamCallResults = Record<SablierStreamCall, unknown>;

export interface VerifiedSablierStream {
  blockNumber: number;
  depositedMinor: string;
  endTime: number;
  isDepleted: boolean;
  lockedMinor: string;
  recipient: string;
  refundedMinor: string;
  sender: string;
  streamId: string;
  wasCanceled: boolean;
  withdrawnMinor: string;
}

const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT40 = (1n << 40n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

export function isSablierStreamId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 78 &&
    /^[1-9]\d*$/u.test(value) &&
    BigInt(value) <= MAX_UINT256
  );
}

/** ABI-encoded call data for every pinned stream view, bound to one id. */
export function sablierStreamCallData(
  streamId: string,
): Record<SablierStreamCall, string> {
  if (!isSablierStreamId(streamId)) {
    throw new TypeError("stream id is not a canonical uint256 integer");
  }
  const argument = BigInt(streamId).toString(16).padStart(64, "0");
  const entries = Object.entries(SABLIER_STREAM_SELECTORS).map(
    ([call, selector]) => [call, `${selector}${argument}`],
  );
  return Object.fromEntries(entries) as Record<SablierStreamCall, string>;
}

function returnWord(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${field} is not one canonical 32-byte return word`);
  }
  return value.slice(2);
}

function wordAddress(value: unknown, field: string): string {
  const word = returnWord(value, field);
  if (!word.startsWith("0".repeat(24))) {
    throw new TypeError(`${field} is not a canonical address word`);
  }
  const address = `0x${word.slice(24)}`;
  if (/^0x0{40}$/u.test(address)) {
    throw new TypeError(`${field} is the zero address`);
  }
  return address;
}

function wordUint(value: unknown, maximum: bigint, field: string): bigint {
  const word = returnWord(value, field);
  const parsed = BigInt(`0x${word}`);
  if (parsed > maximum) {
    throw new TypeError(`${field} exceeds its declared integer width`);
  }
  return parsed;
}

function wordBoolean(value: unknown, field: string): boolean {
  const word = returnWord(value, field);
  if (word === "0".repeat(64)) return false;
  if (word === `${"0".repeat(63)}1`) return true;
  throw new TypeError(`${field} is not a canonical boolean word`);
}

/**
 * Validates one authority's finalized `eth_call` results for a Sablier
 * Lockup v4 stream: the canonical USDC token, the exact expected recipient,
 * bounded canonical integers, a non-negative locked balance (deposited minus
 * withdrawn minus refunded), and a stream the sender can no longer cancel.
 * A cancelable stream lets the funder reclaim the undistributed balance at
 * any time, so it can never back a positive `committedMinor`; it fails closed
 * here before any evidence is emitted.
 */
export function assertSablierStreamState(
  callResults: SablierStreamCallResults,
  network: SablierNetwork,
  streamId: string,
  expected: { blockNumber: number; recipient: string },
): VerifiedSablierStream {
  if (network !== "base" && network !== "ethereum") {
    throw new TypeError("network is not a Sablier commitment network");
  }
  if (!isSablierStreamId(streamId)) {
    throw new TypeError("stream id is not a canonical uint256 integer");
  }
  if (!isFundingAddress(network, expected.recipient)) {
    throw new TypeError("expected recipient is not a canonical EVM address");
  }
  if (!Number.isSafeInteger(expected.blockNumber) || expected.blockNumber < 0) {
    throw new TypeError("block number must be a non-negative safe integer");
  }
  const token = wordAddress(
    callResults.underlyingToken,
    "stream underlying token",
  );
  if (token !== EVM_FUNDING_USDC_CONTRACTS[network]) {
    throw new TypeError("stream underlying token is not canonical USDC");
  }
  const recipient = wordAddress(callResults.recipient, "stream recipient");
  if (recipient !== expected.recipient) {
    throw new TypeError("stream recipient is not the expected project address");
  }
  const sender = wordAddress(callResults.sender, "stream sender");
  const deposited = wordUint(
    callResults.depositedAmount,
    MAX_UINT128,
    "stream deposited amount",
  );
  const withdrawn = wordUint(
    callResults.withdrawnAmount,
    MAX_UINT128,
    "stream withdrawn amount",
  );
  const refunded = wordUint(
    callResults.refundedAmount,
    MAX_UINT128,
    "stream refunded amount",
  );
  const locked = deposited - withdrawn - refunded;
  if (locked < 0n) {
    throw new TypeError("stream locked balance is negative");
  }
  const endTime = wordUint(callResults.endTime, MAX_UINT40, "stream end time");
  if (wordBoolean(callResults.isCancelable, "stream cancelable flag")) {
    throw new TypeError(
      "stream is cancelable and cannot back committed funding",
    );
  }
  return {
    blockNumber: expected.blockNumber,
    depositedMinor: deposited.toString(),
    endTime: Number(endTime),
    isDepleted: wordBoolean(callResults.isDepleted, "stream depleted flag"),
    lockedMinor: locked.toString(),
    recipient,
    refundedMinor: refunded.toString(),
    sender,
    streamId,
    wasCanceled: wordBoolean(callResults.wasCanceled, "stream canceled flag"),
    withdrawnMinor: withdrawn.toString(),
  };
}

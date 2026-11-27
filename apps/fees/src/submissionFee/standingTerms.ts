// spec/fees/submissionFeeStandingDeposits.md, "A standing deposit pays its row only as burned SLOP on the standing ledger"; spec/fees/submissionFeeDeposits.md, "A deposit pays its pull request only when it meets every term, and only one deposit pays it"
import { keccak_256 } from "@noble/hashes/sha3.js";
import { burnAddress, tokenKind } from "../../gen/backend__submissionFeeTerms.ts";

export const STANDING_DEPOSIT_NETWORK = "robinhood-mainnet";
export const STANDING_DEPOSIT_LEDGER = "robinhood-standing";
export const STANDING_DEPOSIT_CONTRACT = "0x446604d5c3Cc99c60CCE3d5C4357BC60f5b45993";
export const STANDING_DEPOSIT_START_BLOCK = 122128533;
export const STANDING_DEPOSIT_USD_MINOR = "10000000";
export const STANDING_DEPOSIT_COVER_LIMIT = 50;

const SLOP_DECIMALS = 18n;
const STABLE_DECIMALS = 6n;
const ONE_SLOP = 10n ** SLOP_DECIMALS;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,38})$/u;
const RATE_PATTERN = /^([0-9]+)(?:\.([0-9]+))?$/u;
const UINT64_MAX = (1n << 64n) - 1n;

export interface StandingRow {
  readonly id: string;
  readonly item: string;
  readonly slopAmount: string;
  readonly cancelledAt: string | null;
  readonly paidNetwork: string | null;
  readonly paidDepositId: number | null;
  readonly outcome: string | null;
}

export type StandingDepositRefusal =
  | "unknown_item"
  | "token_not_accepted"
  | "standing_wrong_ledger"
  | "standing_token_not_slop"
  | "wrong_kept_to"
  | "standing_cancelled"
  | "standing_amount_invalid"
  | "amount_below_due"
  | "item_already_paid"
  | "item_already_decided";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function chainOf(network: string): string {
  return network === STANDING_DEPOSIT_LEDGER ? STANDING_DEPOSIT_NETWORK : network;
}

function uint64Of(value: number): bigint | undefined {
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  const big = BigInt(value);
  return big <= UINT64_MAX ? big : undefined;
}

/** @throws {never} */
export function standingDepositItem(githubId: number, round: number): string | undefined {
  const account = uint64Of(githubId);
  const sequence = uint64Of(round);
  if (account === undefined || sequence === undefined) return undefined;
  const tag = new TextEncoder().encode("slop-standing-v1");
  const packed = new Uint8Array(tag.length + 16);
  packed.set(tag, 0);
  const view = new DataView(packed.buffer);
  view.setBigUint64(tag.length, account, false);
  view.setBigUint64(tag.length + 8, sequence, false);
  return `0x${[...keccak_256(packed)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function scaledRate(slopPerUsd: string): bigint | undefined {
  const trimmed = slopPerUsd.trim();
  const match = RATE_PATTERN.exec(trimmed);
  if (match === null) return undefined;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").slice(0, 18).padEnd(18, "0");
  const scaled = BigInt(whole) * ONE_SLOP + BigInt(fraction);
  return scaled > 0n ? scaled : undefined;
}

/** @throws {never} */
export function standingDepositAmount(slopPerUsd: string): string | undefined {
  const rate = scaledRate(slopPerUsd);
  if (rate === undefined) return undefined;
  const numerator = BigInt(STANDING_DEPOSIT_USD_MINOR) * rate;
  const denominator = 10n ** STABLE_DECIMALS * ONE_SLOP;
  const whole = (numerator + denominator - 1n) / denominator;
  return (whole * ONE_SLOP).toString();
}

/** @throws {never} */
export function standingDepositDeployed(
  contract: string | null = STANDING_DEPOSIT_CONTRACT,
  startBlock: number | null = STANDING_DEPOSIT_START_BLOCK,
): boolean {
  return typeof contract === "string" && ADDRESS_PATTERN.test(contract) && typeof startBlock === "number" && Number.isSafeInteger(startBlock) && startBlock >= 0;
}

/** @throws {never} */
export function standingDepositCounts(
  network: string,
  deposit: {
    readonly depositId: number;
    readonly token: string;
    readonly amount: string;
    readonly keptTo: string;
  },
  row: StandingRow | null,
): { readonly accepted: true; readonly due: string } | { readonly accepted: false; readonly reason: StandingDepositRefusal } {
  const refuse = (reason: StandingDepositRefusal) => ({ accepted: false, reason }) as const;
  const kind = tokenKind(chainOf(network), deposit.token.toLowerCase());
  if (kind === "NoToken") return refuse("token_not_accepted");
  if (network !== STANDING_DEPOSIT_LEDGER) return refuse("standing_wrong_ledger");
  if (kind !== "SlopToken") return refuse("standing_token_not_slop");
  if (!sameAddress(deposit.keptTo, burnAddress)) return refuse("wrong_kept_to");
  if (row === null) return refuse("unknown_item");
  if (row.cancelledAt !== null) return refuse("standing_cancelled");
  if (!AMOUNT_PATTERN.test(row.slopAmount) || BigInt(row.slopAmount) <= 0n) return refuse("standing_amount_invalid");
  if (!AMOUNT_PATTERN.test(deposit.amount)) return refuse("amount_below_due");
  const due = BigInt(row.slopAmount);
  if (BigInt(deposit.amount) < due) return refuse("amount_below_due");
  const paidBy = row.paidDepositId;
  const own = paidBy !== null && row.paidNetwork === network && paidBy === deposit.depositId;
  if (!own && paidBy !== null) return refuse("item_already_paid");
  if (!own && row.outcome !== null) return refuse("item_already_decided");
  return { accepted: true, due: due.toString() };
}

/** @throws {never} */
export function standingResolveAction(
  network: string,
  deposit: {
    readonly depositId: number;
    readonly token: string;
    readonly keptTo: string;
    readonly finalizedAt: string | null;
    readonly state: string;
    readonly accepted: number | null;
  },
  row: StandingRow | null,
): "refund" | "keep" | null {
  if (deposit.finalizedAt === null) return null;
  if (deposit.state !== "open" && deposit.state !== "refund_due" && deposit.state !== "kept_due") return null;
  const kind = tokenKind(chainOf(network), deposit.token.toLowerCase());
  if (kind === "NoToken") return null;
  if (deposit.accepted === 0) return "refund";
  if (deposit.accepted !== 1) return null;
  if (row === null || row.paidNetwork !== network || row.paidDepositId !== deposit.depositId) return null;
  if (row.outcome === "refund_due") return "refund";
  if (row.outcome === "kept_due" && network === STANDING_DEPOSIT_LEDGER && kind === "SlopToken" && sameAddress(deposit.keptTo, burnAddress)) return "keep";
  return null;
}

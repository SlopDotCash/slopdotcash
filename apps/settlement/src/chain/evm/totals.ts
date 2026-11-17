// spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"; spec/settlement/escrow.md, "Events apply once, in canonical block and event order"
import { type EvmAddress, type Hex, U128_MAX, U256_MAX, answerWords, decodeAddress, decodeUint, escrowGetter, isZero, wordUint } from "./abi.ts";

export const TOTALS_CALL: Hex = escrowGetter("totals");
export const TOKEN_CALL: Hex = escrowGetter("token");
export const DECIMALS_CALL: Hex = escrowGetter("decimals");
export const PENDING_MONTHLY_CALL: Hex = escrowGetter("pendingMonthlyGross");

export interface VaultCounters {
  readonly deposited: bigint;
  readonly paid: bigint;
  readonly payoutFees: bigint;
  readonly grossWithdrawn: bigint;
  readonly withdrawalFees: bigint;
  readonly free: bigint;
  readonly reservedPrincipal: bigint;
  readonly reservedFees: bigint;
  readonly accruedFees: bigint;
  readonly balance: bigint;
}

export interface TotalsAnswers {
  readonly totals: string;
  readonly token: string;
  readonly decimals: string;
}

export interface VaultTotalsRead {
  readonly counters: VaultCounters;
  readonly asset: EvmAddress;
  readonly decimals: number;
  readonly native: boolean;
}

export interface EvmVaultTotals extends VaultTotalsRead {
  readonly pendingMonthly: bigint;
  readonly reserved: bigint | undefined;
}

export type TotalsRefusal = "MalformedTotals" | "MalformedAsset" | "NativeBalanceMismatch" | "NotConserved";

export type TotalsOutcome = { readonly kind: "Totals"; readonly totals: EvmVaultTotals } | { readonly kind: "Refused"; readonly refusal: TotalsRefusal };

const refusalMessages: Readonly<Record<TotalsRefusal, string>> = {
  MalformedTotals: "Malformed vault totals",
  MalformedAsset: "Malformed vault asset",
  NativeBalanceMismatch: "Native vault totals do not match its ETH balance",
  NotConserved: "Vault totals do not conserve",
};

/** @throws {never} */
export function totalsRefusalMessage(refusal: TotalsRefusal): string {
  return refusalMessages[refusal];
}

/** @throws {never} */
export function decodeCounters(data: string): VaultCounters | undefined {
  const words = answerWords(data, 10);
  if (words === undefined) return undefined;
  const counters = words.slice(0, 9).map((word) => wordUint(word, U128_MAX));
  const balance = wordUint(words[9], U256_MAX);
  const [deposited, paid, payoutFees, grossWithdrawn, withdrawalFees, free, reservedPrincipal, reservedFees, accruedFees] = counters;
  if (deposited === undefined || paid === undefined || payoutFees === undefined || grossWithdrawn === undefined || withdrawalFees === undefined || free === undefined || reservedPrincipal === undefined || reservedFees === undefined || accruedFees === undefined || balance === undefined) return undefined;
  return { deposited, paid, payoutFees, grossWithdrawn, withdrawalFees, free, reservedPrincipal, reservedFees, accruedFees, balance };
}

const refused = (refusal: TotalsRefusal): TotalsOutcome => ({ kind: "Refused", refusal });

/** @throws {never} */
export function readTotals(answers: TotalsAnswers): VaultTotalsRead | TotalsRefusal {
  const counters = decodeCounters(answers.totals);
  if (counters === undefined) return "MalformedTotals";
  const asset = decodeAddress(answers.token);
  const decimals = decodeUint(answers.decimals, U256_MAX);
  if (asset === undefined || decimals === undefined || decimals > 255n) return "MalformedAsset";
  return { counters, asset, decimals: Number(decimals), native: isZero(asset) };
}

/** @throws {never} */
export function accountedGross(counters: VaultCounters): bigint {
  return counters.free + counters.reservedPrincipal + counters.reservedFees + counters.paid + counters.payoutFees + counters.grossWithdrawn;
}

/** @throws {never} */
export function needsPendingMonthly(counters: VaultCounters): boolean {
  return counters.deposited > accountedGross(counters);
}

/** @throws {never} */
export function conservedTotals(read: VaultTotalsRead, observed: { readonly pendingMonthly: string | undefined; readonly nativeBalance: bigint | undefined }): TotalsOutcome {
  const { counters } = read;
  if (read.native && (read.decimals !== 18 || observed.nativeBalance !== counters.balance)) return refused("NativeBalanceMismatch");
  const pending = needsPendingMonthly(counters) ? (observed.pendingMonthly === undefined ? undefined : decodeUint(observed.pendingMonthly, U256_MAX)) : 0n;
  if (pending === undefined) return refused("NotConserved");
  const held = counters.free + counters.reservedPrincipal + counters.reservedFees + pending;
  if (counters.deposited !== accountedGross(counters) + pending || pending > U128_MAX || counters.balance < held + counters.accruedFees) return refused("NotConserved");
  return { kind: "Totals", totals: { ...read, pendingMonthly: pending, reserved: pending > 0n ? counters.reservedPrincipal + counters.reservedFees + pending : undefined } };
}

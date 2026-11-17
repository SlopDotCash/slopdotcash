// spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"; spec/settlement/money.md, "Every amount contains only integer limbs from zero through 999"
import { type Amount, maxU128, maxU64, withinMaximum } from "../../gen/settlement__money.ts";

const LIMB = 1000n;
const CANONICAL = /^(?:0|[1-9][0-9]*)$/u;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const NATIVE_COST = /^[1-9][0-9]{0,77}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;

export const MAX_DECIMALS = 36;

/** @throws {never} */
export function fromAmount(amount: Amount): bigint {
  return amount.reduceRight((value, limb) => value * LIMB + BigInt(limb), 0n);
}

/** @throws {RangeError} */
export function toAmount(value: bigint): Amount {
  if (value < 0n) throw new RangeError("A base-unit amount is never negative");
  const limbs: number[] = [];
  let rest = value;
  do {
    limbs.push(Number(rest % LIMB));
    rest /= LIMB;
  } while (rest > 0n);
  return limbs;
}

export const MAX_BASE_UNITS = fromAmount(maxU128);
export const MAX_SOLANA_BASE_UNITS = fromAmount(maxU64);

export type Family = "evm" | "solana";

const limbMaximum = { evm: maxU128, solana: maxU64 } as const satisfies Record<Family, Amount>;

/** @throws {never} */
export function maxBaseUnitsFor(family: Family): bigint {
  return family === "solana" ? MAX_SOLANA_BASE_UNITS : MAX_BASE_UNITS;
}

/** @throws {never} */
export function withinNetworkRange(value: bigint, family: Family): boolean {
  return value >= 0n && withinMaximum(toAmount(value), limbMaximum[family]);
}

/** @throws {never} */
export function parseBaseUnits(text: string, maximum: bigint = MAX_BASE_UNITS): bigint | undefined {
  if (text.length > maximum.toString().length || !CANONICAL.test(text)) return undefined;
  const value = BigInt(text);
  return value <= maximum ? value : undefined;
}

/** @throws {never} */
export function parseNativeCostLimit(text: string): bigint | undefined {
  if (!NATIVE_COST.test(text)) return undefined;
  const value = BigInt(text);
  return value <= MAX_UINT256 ? value : undefined;
}

export type DecimalRefusal = "NotDecimal" | "TooManyDecimals" | "OutOfRange";

export type ParsedDecimal = { kind: "Parsed"; amount: bigint } | { kind: "Refused"; reason: DecimalRefusal };

const decimalsValid = (decimals: number) => Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS;

/** @throws {never} */
export function parseDecimalAmount({ text, decimals, maximum = MAX_BASE_UNITS }: { text: string; decimals: number; maximum?: bigint }): ParsedDecimal {
  const match = DECIMAL.exec(text);
  if (!match || !decimalsValid(decimals)) return { kind: "Refused", reason: "NotDecimal" };
  const whole = match[1] ?? "";
  const fraction = (match[2] ?? ".").slice(1);
  if (fraction.length > decimals) return { kind: "Refused", reason: "TooManyDecimals" };
  if (whole.length > maximum.toString().length) return { kind: "Refused", reason: "OutOfRange" };
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0") * 10n ** BigInt(decimals - fraction.length);
  return amount > 0n && amount <= maximum ? { kind: "Parsed", amount } : { kind: "Refused", reason: "OutOfRange" };
}

export const decimalRefusalMessage = {
  NotDecimal: () => "Enter a positive amount using digits and a decimal point.",
  TooManyDecimals: (decimals: number) => `This token supports at most ${decimals} decimal places.`,
  OutOfRange: () => "The amount is outside the vault's supported range.",
} as const satisfies Record<DecimalRefusal, (decimals: number) => string>;

/** @throws {RangeError} */
export function formatBaseUnits({ value, decimals, grouping = true }: { value: bigint; decimals: number; grouping?: boolean }): string {
  if (value < 0n) throw new RangeError("A base-unit amount is never negative");
  if (!decimalsValid(decimals)) throw new RangeError("asset decimals must be an integer from 0 to 36");
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString();
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  const shown = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",") : whole;
  return fraction ? `${shown}.${fraction}` : shown;
}

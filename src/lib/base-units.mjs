/**
 * Integer base units of an asset as decimal text, without floating point
 * (owner decision D11: amounts use asset base units).
 */
import { CANONICAL_UINT } from "./record-validation.mjs";

/**
 * Exact decimal text of base units. The whole part has comma groups unless
 * `grouping` is false; trailing fraction zeros are removed.
 */
export function formatBaseUnits(value, decimals, { grouping = true } = {}) {
  if (typeof value !== "string" || !CANONICAL_UINT.test(value))
    throw new TypeError("amount must be canonical integer base units");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new RangeError("asset decimals must be an integer from 0 to 36");
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(value);
  const whole = (amount / scale).toString();
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/u, "");
  const shown = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",") : whole;
  return fraction ? `${shown}.${fraction}` : shown;
}

/** Base units of a decimal amount split into its whole and fraction digits. */
export function decimalBaseUnits(whole, fraction, decimals) {
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

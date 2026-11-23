// spec/backend/submissionFeeTerms.md, "The submission fee terms are published constants that change only by a reviewed change"
import { maxMinor, minMinor, slopShareBps, stableDecimals } from "../../gen/backend__submissionFeeTerms.ts";

const digits = /^[0-9]+$/u;

export const stableUnit = 10n ** BigInt(stableDecimals);
export const minUnits = BigInt(minMinor);
export const maxUnits = BigInt(maxMinor);
export const slopShareUnits = BigInt(slopShareBps);

/** @throws {never} */
export function digitUnits(text: string): bigint | undefined {
  return digits.test(text) ? BigInt(text) : undefined;
}

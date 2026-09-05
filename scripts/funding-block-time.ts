/** Integer Unix inclusion seconds supplied by the fixed chain authorities. */
export function assertFundingBlockTime(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 253_402_300_799
  ) {
    throw new TypeError("funding chain inclusion time is missing or invalid");
  }
  return value;
}

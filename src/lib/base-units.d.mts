/** Integer base units of an asset as decimal text, without floating point. */
export declare function formatBaseUnits(
  value: string,
  decimals: number,
  options?: { grouping?: boolean },
): string;
/** Requires unsigned decimal digit components and integer precision from 0 to 36. */
export declare function decimalBaseUnits(
  whole: string,
  fraction: string,
  decimals: number,
): bigint;

/** Integer base units of an asset as decimal text, without floating point. */
export declare function formatBaseUnits(
  value: string,
  decimals: number,
  options?: { grouping?: boolean },
): string;
export declare function decimalBaseUnits(
  whole: string,
  fraction: string,
  decimals: number,
): bigint;

/** Strict record primitives shared by public record readers. */
export declare function isRecord(
  value: unknown,
): value is Record<string, unknown>;
export declare function readRecord(
  value: unknown,
  field: string,
): Record<string, unknown>;
export declare function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void;
export declare const EXACT_UTC: RegExp;
export declare function isExactUtc(value: unknown): value is string;
export declare function timestamp(value: unknown, field: string): string;
export declare const CANONICAL_UINT: RegExp;
export declare function isCanonicalUint(value: unknown): value is string;
export declare function boundedText(
  value: unknown,
  field: string,
  options: { min?: number; max: number; pattern?: RegExp },
): string;

export declare function nonNegativeInteger(
  value: unknown,
  path: string,
): number;

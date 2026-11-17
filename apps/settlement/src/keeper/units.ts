// spec/settlement/keeperLifecycle.md, "Native fee liability and nonce become durable with the exact signed bytes"

export const MAX_EXACT = BigInt(Number.MAX_SAFE_INTEGER);

const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const QUANTITY = /^0x[0-9a-fA-F]+$/u;

/** @throws {never} */
export function widen(value: number): bigint {
  return BigInt(Number.isSafeInteger(value) ? value : 0);
}

/** @throws {never} */
export function decimal(text: string): bigint | undefined {
  return DECIMAL.test(text) ? BigInt(text) : undefined;
}

/** @throws {never} */
export function quantityOf(text: string): bigint | undefined {
  return QUANTITY.test(text) ? BigInt(text) : undefined;
}

/** @throws {never} */
export function exact(value: bigint): number | undefined {
  return value >= -MAX_EXACT && value <= MAX_EXACT ? Number(value) : undefined;
}

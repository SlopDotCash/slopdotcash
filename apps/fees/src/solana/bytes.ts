// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/fees/conversion.md, "Only a finalized receipt of one of the row's own attempts settles it"
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

const wholeDecimal = /^(0|[1-9][0-9]*)$/u;
const maxU64 = (1n << 64n) - 1n;

/** @throws {never} */
export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @throws {never} */
export function digest58(bytes: Uint8Array): string {
  return base58.encode(sha256(bytes));
}

/** @throws {never} */
export function u64At(bytes: Uint8Array, at: number): bigint | undefined {
  if (!Number.isInteger(at) || at < 0 || at + 8 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(at, true);
}

/** @throws {never} */
export function u32At(bytes: Uint8Array, at: number): number | undefined {
  if (!Number.isInteger(at) || at < 0 || at + 4 > bytes.length) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
}

/** @throws {never} */
export function u64Bytes(value: bigint): Uint8Array | undefined {
  if (value < 0n || value > maxU64) return undefined;
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

/** @throws {never} */
export function shortVec(value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value;
  do {
    const low = rest & 127;
    rest >>>= 7;
    bytes.push(rest === 0 ? low : low | 128);
  } while (rest !== 0);
  return Uint8Array.from(bytes);
}

/** @throws {never} */
export function joined(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** @throws {never} */
export function withBytes(raw: Uint8Array, bytes: Uint8Array, at: number): Uint8Array {
  const copy = raw.slice();
  copy.set(bytes, at);
  return copy;
}

/** @throws {never} */
export function wholeText(text: string): bigint | undefined {
  return wholeDecimal.test(text) ? BigInt(text) : undefined;
}

/** @throws {never} */
export function wideOf(value: number): bigint {
  return Number.isSafeInteger(value) ? BigInt(value) : -1n;
}

/** @throws {never} */
export function jsonText(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

/** @throws {never} */
export function jsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function sameList(left: ReadonlyArray<string | number>, right: ReadonlyArray<string | number>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** @throws {never} */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** @throws {never} */
export function decimalBps(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(String(value));
  if (match === null) return undefined;
  const fraction = (match[2] ?? "").padEnd(4, "0");
  const whole = BigInt(match[1] ?? "0") * 10_000n + BigInt(fraction.slice(0, 4));
  const rest = /[1-9]/u.test(fraction.slice(4)) ? 1n : 0n;
  const bps = whole + rest;
  return bps > BigInt(Number.MAX_SAFE_INTEGER) ? undefined : Number(bps);
}

/** @throws {never} */
export function venuesOf(routePlan: unknown): string[] {
  if (!Array.isArray(routePlan)) return [];
  return routePlan
    .map((step: unknown) => (typeof step === "object" && step !== null && "swapInfo" in step ? (step as { swapInfo?: { label?: unknown } }).swapInfo?.label : undefined))
    .filter((label): label is string => typeof label === "string")
    .slice(0, 8);
}

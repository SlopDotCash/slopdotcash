// spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export type U64 = bigint & { readonly __brand: "SolanaU64" };
export type I64 = bigint & { readonly __brand: "SolanaI64" };
export type Digest = string & { readonly __brand: "SolanaDigest" };

export const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const DIGEST_TEXT = /^(?:0x)?([0-9a-fA-F]{64})$/u;

/** @throws {never} */
export function u64(value: bigint): U64 | undefined {
  return value >= 0n && value <= U64_MAX ? (value as U64) : undefined;
}

/** @throws {never} */
export function i64(value: bigint): I64 | undefined {
  return value >= I64_MIN && value <= I64_MAX ? (value as I64) : undefined;
}

/** @throws {never} */
export function digest(text: string): Digest | undefined {
  const match = DIGEST_TEXT.exec(text);
  return match ? (match[1].toLowerCase() as Digest) : undefined;
}

/** @throws {never} */
export function digestOf(bytes: Uint8Array): Digest | undefined {
  return bytes.length === 32 ? (bytesToHex(bytes) as Digest) : undefined;
}

/** @throws {never} */
export function digestBytes(value: Digest): Uint8Array {
  return hexToBytes(value);
}

/** @throws {never} */
export function isZeroDigest(value: Digest): boolean {
  return /^0{64}$/u.test(value);
}

/** @throws {never} */
export function hex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/** @throws {never} */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** @throws {never} */
export function concat(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** @throws {never} */
export function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  view(bytes).setUint32(0, value >>> 0, true);
  return bytes;
}

/** @throws {never} */
export function u64le(value: U64): Uint8Array {
  const bytes = new Uint8Array(8);
  view(bytes).setBigUint64(0, value, true);
  return bytes;
}

/** @throws {never} */
export function i64le(value: I64): Uint8Array {
  const bytes = new Uint8Array(8);
  view(bytes).setBigInt64(0, value, true);
  return bytes;
}

/** @throws {never} */
export function readU32(bytes: Uint8Array, at: number): number {
  return view(bytes).getUint32(at, true);
}

/** @throws {never} */
export function readU64(bytes: Uint8Array, at: number): U64 {
  return view(bytes).getBigUint64(at, true) as U64;
}

/** @throws {never} */
export function readI64(bytes: Uint8Array, at: number): I64 {
  return view(bytes).getBigInt64(at, true) as I64;
}

/** @throws {never} */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

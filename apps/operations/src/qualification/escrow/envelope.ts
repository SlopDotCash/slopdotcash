// spec/operations/escrowQualification.md, "Each new attempt passes current checks, fits the remaining budget, and binds the exact scoped operation"

type Item =
  | { readonly kind: "bytes"; readonly value: Uint8Array; readonly encoded: Uint8Array }
  | { readonly kind: "list"; readonly items: ReadonlyArray<Item>; readonly encoded: Uint8Array };

export interface SignedEvmTransaction {
  readonly chainId: bigint;
  readonly nonce: bigint;
  readonly gas: bigint;
  readonly maxFeePerGas: bigint;
  readonly to: string;
  readonly value: bigint;
  readonly input: string;
  readonly accessListEmpty: boolean;
  readonly signingPayload: Uint8Array;
  readonly signature: string;
}

export type Envelope = { readonly kind: "decoded"; readonly value: SignedEvmTransaction } | { readonly kind: "malformed"; readonly issue: string };

const HALF_ORDER = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const EVEN_HEX = /^0x(?:[0-9a-f]{2})+$/u;

/** @throws {never} */
export function hexBytes(hex: string): Uint8Array | undefined {
  if (!EVEN_HEX.test(hex)) return undefined;
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(2 + index * 2, 4 + index * 2), 16);
  return bytes;
}

/** @throws {never} */
export function bytesHex(bytes: Uint8Array): string {
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

function lengthAt(bytes: Uint8Array, at: number, size: number, limit: number): number | undefined {
  if (size > 4 || at + size > limit || bytes[at] === 0) return undefined;
  let length = 0;
  for (let index = 0; index < size; index += 1) length = length * 256 + (bytes[at + index] ?? 0);
  return length > 55 ? length : undefined;
}

function itemAt(bytes: Uint8Array, at: number, limit: number): { readonly item: Item; readonly end: number } | undefined {
  const prefix = bytes[at];
  if (prefix === undefined || at >= limit) return undefined;
  if (prefix < 0x80) return { item: { kind: "bytes", value: bytes.subarray(at, at + 1), encoded: bytes.subarray(at, at + 1) }, end: at + 1 };
  const short = prefix <= 0xb7 || (prefix >= 0xc0 && prefix <= 0xf7);
  const size = short ? 0 : prefix <= 0xbf ? prefix - 0xb7 : prefix - 0xf7;
  const length = short ? prefix - (prefix <= 0xb7 ? 0x80 : 0xc0) : lengthAt(bytes, at + 1, size, limit);
  const start = at + 1 + size;
  if (length === undefined || start + length > limit) return undefined;
  const end = start + length;
  const encoded = bytes.subarray(at, end);
  if (prefix <= 0xbf) {
    if (length === 1 && (bytes[start] ?? 0) < 0x80) return undefined;
    return { item: { kind: "bytes", value: bytes.subarray(start, end), encoded }, end };
  }
  const items: Item[] = [];
  let cursor = start;
  while (cursor < end) {
    const next = itemAt(bytes, cursor, end);
    if (next === undefined) return undefined;
    items.push(next.item);
    cursor = next.end;
  }
  return { item: { kind: "list", items, encoded }, end };
}

function encodedBytes(value: Uint8Array): Uint8Array {
  if (value.length === 1 && (value[0] ?? 0) < 0x80) return value;
  return concat([header(0x80, value.length), value]);
}

function header(base: number, length: number): Uint8Array {
  if (length <= 55) return Uint8Array.of(base + length);
  const size: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) size.unshift(rest % 256);
  return Uint8Array.of(base + 55 + size.length, ...size);
}

function encodedList(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const body = concat(parts);
  return concat([header(0xc0, body.length), body]);
}

function integerBytes(value: bigint): Uint8Array {
  const out: number[] = [];
  for (let rest = value; rest > 0n; rest /= 256n) out.unshift(Number(rest % 256n));
  return Uint8Array.from(out);
}

function integer(item: Item | undefined, maxBytes = 32): bigint | undefined {
  if (item?.kind !== "bytes" || item.value.length > maxBytes || item.value[0] === 0) return undefined;
  return item.value.reduce((total, byte) => total * 256n + BigInt(byte), 0n);
}

function addressOf(item: Item | undefined): string | undefined {
  return item?.kind === "bytes" && item.value.length === 20 ? bytesHex(item.value) : undefined;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

interface Fields {
  readonly chainId: bigint;
  readonly nonce: Item | undefined;
  readonly fee: Item | undefined;
  readonly gas: Item | undefined;
  readonly to: Item | undefined;
  readonly value: Item | undefined;
  readonly input: Item | undefined;
  readonly accessList: Item | undefined;
  readonly parity: bigint | undefined;
  readonly r: Item | undefined;
  readonly s: Item | undefined;
  readonly signingPayload: Uint8Array;
}

function decoded(fields: Fields): Envelope {
  const nonce = integer(fields.nonce, 8);
  const fee = integer(fields.fee);
  const gas = integer(fields.gas, 8);
  const to = addressOf(fields.to);
  const value = integer(fields.value);
  const r = integer(fields.r);
  const s = integer(fields.s);
  const parity = fields.parity;
  if (nonce === undefined || fee === undefined || gas === undefined || value === undefined) return { kind: "malformed", issue: "a nonce, fee, gas or value field is not a canonical integer" };
  if (to === undefined) return { kind: "malformed", issue: "the transaction has no 20-byte recipient" };
  if (fields.input?.kind !== "bytes") return { kind: "malformed", issue: "the transaction input is not a byte string" };
  if (r === undefined || s === undefined || r === 0n || s === 0n || s > HALF_ORDER || parity === undefined || parity > 1n) return { kind: "malformed", issue: "the signature is not a canonical secp256k1 signature" };
  return {
    kind: "decoded",
    value: {
      chainId: fields.chainId,
      nonce,
      gas,
      maxFeePerGas: fee,
      to,
      value,
      input: bytesHex(fields.input.value),
      accessListEmpty: fields.accessList === undefined || (fields.accessList.kind === "list" && fields.accessList.items.length === 0),
      signingPayload: fields.signingPayload,
      signature: `0x${word(r)}${word(s)}${(27n + parity).toString(16)}`,
    },
  };
}

function legacy(items: ReadonlyArray<Item>): Envelope {
  const v = integer(items[6]);
  if (items.length !== 9 || v === undefined) return { kind: "malformed", issue: "a legacy transaction has nine fields" };
  if (v < 35n) return { kind: "malformed", issue: "a legacy transaction without a chain id (EIP-155) is refused" };
  const chainId = (v - 35n) / 2n;
  const unsigned = items.slice(0, 6).map((item) => item.encoded);
  return decoded({
    chainId,
    nonce: items[0],
    fee: items[1],
    gas: items[2],
    to: items[3],
    value: items[4],
    input: items[5],
    accessList: undefined,
    parity: (v - 35n) % 2n,
    r: items[7],
    s: items[8],
    signingPayload: encodedList([...unsigned, encodedBytes(integerBytes(chainId)), Uint8Array.of(0x80), Uint8Array.of(0x80)]),
  });
}

function typed(kind: 1 | 2, items: ReadonlyArray<Item>): Envelope {
  const fields = kind === 1 ? 11 : 12;
  const chainId = integer(items[0], 8);
  if (items.length !== fields || chainId === undefined) return { kind: "malformed", issue: `a type ${kind} transaction has ${fields} fields and a chain id` };
  const shift = kind === 1 ? 0 : 1;
  return decoded({
    chainId,
    nonce: items[1],
    fee: items[2 + shift],
    gas: items[3 + shift],
    to: items[4 + shift],
    value: items[5 + shift],
    input: items[6 + shift],
    accessList: items[7 + shift],
    parity: integer(items[8 + shift], 1),
    r: items[9 + shift],
    s: items[10 + shift],
    signingPayload: concat([Uint8Array.of(kind), encodedList(items.slice(0, 8 + shift).map((item) => item.encoded))]),
  });
}

/** @throws {never} */
export function decodeSignedEvm(raw: string): Envelope {
  const bytes = hexBytes(raw);
  if (bytes === undefined) return { kind: "malformed", issue: "the signed EVM transaction must be lower-case 0x hex" };
  const kind = bytes[0] ?? 0;
  const body = kind === 1 || kind === 2 ? bytes.subarray(1) : bytes;
  const parsed = itemAt(body, 0, body.length);
  if (parsed === undefined || parsed.end !== body.length || parsed.item.kind !== "list") return { kind: "malformed", issue: "the signed EVM transaction is not one canonical RLP list" };
  if (kind === 1 || kind === 2) return typed(kind, parsed.item.items);
  if (kind >= 0xc0) return legacy(parsed.item.items);
  return { kind: "malformed", issue: `transaction type ${kind} is not legacy, EIP-2930 or EIP-1559` };
}

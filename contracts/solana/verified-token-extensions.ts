/**
 * Byte-exact Token-2022 TLV traversal. The explicit sequence mapping covers only
 * Uint8Array length and bounded indexed reads; this code neither mutates bytes
 * nor uses Array-only operations. The caller owns the decoded byte buffer.
 */

export interface ExtensionRecord {
  type: number;
  start: number;
  length: number;
}

export interface ExtensionScan {
  /** 0: complete, 1: base truncated, 2: account type, 3: TLV truncated, 4: type, 5: duplicate. */
  error: number;
  at: number;
  type: number;
  records: ExtensionRecord[];
}

//@ verify
//@ type bytes number[]
//@ requires 0 <= at && at + 1 < bytes.length
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result == bytes[at] + bytes[at + 1] * 256
//@ ensures 0 <= \result && \result <= 65535
function littleEndian16(bytes: Uint8Array, at: number): number {
  return bytes[at] + bytes[at + 1] * 256;
}

//@ verify
//@ type bytes number[]
//@ requires 0 <= at && at <= bytes.length
//@ ensures \result <==> forall(i, at <= i && i < bytes.length ==> bytes[i] == 0)
function zeroSuffix(bytes: Uint8Array, at: number): boolean {
  let i = at;
  while (i < bytes.length) {
    //@ invariant at <= i && i <= bytes.length
    //@ invariant forall(j, at <= j && j < i ==> bytes[j] == 0)
    if (bytes[i] !== 0) return false;
    i += 1;
  }
  return true;
}

//@ verify
//@ ensures \result <==> exists(i, 0 <= i && i < records.length && records[i].type == type)
function hasType(records: readonly ExtensionRecord[], type: number): boolean {
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant forall(j, 0 <= j && j < i ==> records[j].type != type)
    if (records[i].type === type) return true;
    i += 1;
  }
  return false;
}

/** Parse all headers and payload extents; never copy the remaining byte suffix. */
//@ verify
//@ type bytes number[]
//@ requires bytes.length <= 9007199254740991
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures 0 <= \result.error && \result.error <= 5
//@ ensures (\result.error == 1) <==> bytes.length <= 165
//@ ensures (\result.error == 2) <==> bytes.length > 165 && bytes[165] != accountType
//@ ensures bytes.length > 165 && bytes[165] == accountType ==> ParsedPrefix(bytes, expected, \result.records, \result.at)
//@ ensures \result.error == 0 ==> forall(i, \result.at <= i && i < bytes.length ==> bytes[i] == 0)
//@ ensures \result.error >= 3 ==> \result.at < bytes.length && !ZeroTail(bytes, \result.at)
//@ ensures \result.error == 4 ==> !expected.includes(\result.type)
//@ ensures \result.error == 5 ==> exists(i, 0 <= i && i < \result.records.length && \result.records[i].type == \result.type)
//@ ensures CompleteScan(bytes, accountType, expected, \result)
export function decodeTokenExtensions(
  bytes: Uint8Array,
  accountType: number,
  expected: readonly number[],
): ExtensionScan {
  const records: ExtensionRecord[] = [];
  if (bytes.length <= 165) return { error: 1, at: 166, type: 0, records };
  if (bytes[165] !== accountType)
    return { error: 2, at: 166, type: 0, records };
  let at = 166;
  while (at < bytes.length) {
    //@ invariant 166 <= at && at <= bytes.length
    //@ invariant ParsedPrefix(bytes, expected, records, at)
    if (zeroSuffix(bytes, at)) return { error: 0, at, type: 0, records };
    if (bytes.length - at < 4) return { error: 3, at, type: 0, records };
    const type = littleEndian16(bytes, at);
    const length = littleEndian16(bytes, at + 2);
    if (!expected.includes(type)) return { error: 4, at, type, records };
    if (hasType(records, type)) return { error: 5, at, type, records };
    if (4 + length > bytes.length - at) return { error: 3, at, type, records };
    records.push({ type, start: at + 4, length });
    at += 4 + length;
  }
  return { error: 0, at, type: 0, records };
}

//@ verify
//@ type bytes number[]
//@ requires 0 <= at && at + 3 < bytes.length
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result == U32(bytes, at)
//@ ensures 0 <= \result && \result <= 4294967295
function littleEndian32(bytes: Uint8Array, at: number): number {
  return (
    bytes[at] +
    (bytes[at + 1] << 8) +
    (bytes[at + 2] << 16) +
    bytes[at + 3] * 16777216
  );
}

/** Validate every declared metadata field and require zero-only trailing padding. */
//@ verify
//@ type bytes number[]
//@ requires bytes.length <= 9007199254740991
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result <==> MetadataValid(bytes)
export function metadataPayloadValid(bytes: Uint8Array): boolean {
  if (bytes.length < 72) return false;
  let at = 64;
  let i = 0;
  while (i < 3) {
    //@ invariant 0 <= i && i <= 3
    //@ invariant 64 <= at && at <= bytes.length
    //@ invariant WalkFields(bytes, 64, 3) == WalkFields(bytes, at, 3 - i)
    if (bytes.length - at < 4) return false;
    const length =
      bytes[at] +
      (bytes[at + 1] << 8) +
      (bytes[at + 2] << 16) +
      bytes[at + 3] * 16777216;
    if (length > bytes.length - at - 4) return false;
    at += 4 + length;
    i += 1;
  }
  if (bytes.length - at < 4) return false;
  const count = littleEndian32(bytes, at);
  at += 4;
  if (count > bytes.length / 8) return false;
  //@ ghost let start: number = at
  const fields = count * 2;
  i = 0;
  while (i < fields) {
    //@ invariant 0 <= i && i <= fields
    //@ invariant start <= at && at <= bytes.length
    //@ invariant WalkFields(bytes, start, fields) == WalkFields(bytes, at, fields - i)
    if (bytes.length - at < 4) return false;
    const length =
      bytes[at] +
      (bytes[at + 1] << 8) +
      (bytes[at + 2] << 16) +
      bytes[at + 3] * 16777216;
    if (length > bytes.length - at - 4) return false;
    at += 4 + length;
    i += 1;
  }
  return zeroSuffix(bytes, at);
}

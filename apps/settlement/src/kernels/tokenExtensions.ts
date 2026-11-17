//@ backend dafny
// spec/settlement/money.md, "Token-2022 admission permits only immutable metadata and immutable token ownership"

export interface ExtensionRecord {
  type: number;
  start: number;
  length: number;
}

interface ExtensionScan {
  error: number;
  at: number;
  type: number;
  records: ExtensionRecord[];
}

/** @throws {never} */
//@ pure
function u16(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires 0 <= at && at + 1 < bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result && \result <= 65535
  return bytes[at] + bytes[at + 1] * 256;
}

/** @throws {never} */
//@ pure
function u32(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires 0 <= at && at + 3 < bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result && \result <= 4294967295
  return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 16777216;
}

/** @throws {never} */
//@ pure
function zeroTail(bytes: Uint8Array, at: number): boolean {
  //@ type bytes number[]
  //@ requires 0 <= at
  //@ decreases bytes.length - at
  //@ ensures \result <==> forall(i, at <= i && i < bytes.length ==> bytes[i] === 0)
  return at >= bytes.length || (bytes[at] === 0 && zeroTail(bytes, at + 1));
}

/** @throws {never} */
//@ pure
function nextField(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires -1 <= at && at <= bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result === -1 || (at + 4 <= \result && \result <= bytes.length)
  //@ ensures \result !== -1 <==> (0 <= at && at + 4 <= bytes.length && u32(bytes, at) <= bytes.length - at - 4)
  if (at < 0 || bytes.length - at < 4) return -1;
  const length = u32(bytes, at);
  return length > bytes.length - at - 4 ? -1 : at + 4 + length;
}

/** @throws {never} */
//@ pure
function walkFields(bytes: Uint8Array, at: number, count: number): number {
  //@ type bytes number[]
  //@ requires -1 <= at && at <= bytes.length && count >= 0
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ decreases count
  //@ ensures \result === -1 || (at <= \result && \result <= bytes.length)
  if (count === 0) return at;
  const next = nextField(bytes, at);
  return next < 0 ? -1 : walkFields(bytes, next, count - 1);
}

/** @throws {never} */
//@ pure
export function metadataPayloadValid(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result ==> bytes.length >= 72 && walkFields(bytes, 64, 3) >= 64
  if (bytes.length < 72) return false;
  const stringsEnd = walkFields(bytes, 64, 3);
  if (stringsEnd < 0 || bytes.length - stringsEnd < 4) return false;
  const count = u32(bytes, stringsEnd);
  if (count * 8 > bytes.length) return false;
  const end = walkFields(bytes, stringsEnd + 4, count * 2);
  return end >= 0 && zeroTail(bytes, end);
}

/** @throws {never} */
function dataEnd(bytes: Uint8Array): number {
  //@ type bytes number[]
  //@ ensures 0 <= \result && \result <= bytes.length
  //@ ensures forall(i, \result <= i && i < bytes.length ==> bytes[i] === 0)
  //@ ensures \result === 0 || bytes[\result - 1] !== 0
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    //@ invariant 0 <= end && end <= bytes.length
    //@ invariant forall(i, end <= i && i < bytes.length ==> bytes[i] === 0)
    //@ decreases end
    end = end - 1;
  }
  return end;
}

/** @throws {never} */
function hasType(records: ExtensionRecord[], type: number): boolean {
  //@ ensures \result <==> exists(k, 0 <= k && k < records.length && records[k].type === type)
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant forall(k, 0 <= k && k < i ==> records[k].type !== type)
    if (records[i].type === type) return true;
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
export function decodeTokenExtensions(bytes: Uint8Array, accountType: number): ExtensionScan {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result.error && \result.error <= 4
  //@ ensures (\result.error === 1) <==> bytes.length <= 165
  //@ ensures (\result.error === 2) <==> (bytes.length > 165 && bytes[165] !== accountType)
  //@ ensures \result.error === 1 || \result.error === 2 ==> \result.at === 166 && \result.records.length === 0
  //@ ensures \result.error === 0 ==> 166 <= \result.at && \result.at <= bytes.length && forall(i, \result.at <= i && i < bytes.length ==> bytes[i] === 0)
  //@ ensures \result.error >= 3 ==> 166 <= \result.at && \result.at < bytes.length && exists(i, \result.at <= i && i < bytes.length && bytes[i] !== 0)
  //@ ensures \result.error === 3 ==> \result.at + 4 > bytes.length || \result.at + 4 + bytes[\result.at + 2] + bytes[\result.at + 3] * 256 > bytes.length
  //@ ensures \result.error === 4 ==> \result.at + 4 <= bytes.length && \result.type === bytes[\result.at] + bytes[\result.at + 1] * 256 && exists(k, 0 <= k && k < \result.records.length && \result.records[k].type === \result.type)
  //@ ensures \result.records.length === 0 ? \result.at === 166 : \result.at === \result.records[\result.records.length - 1].start + \result.records[\result.records.length - 1].length
  //@ ensures \result.records.length > 0 ==> \result.records[0].start === 170
  //@ ensures forall(k, 0 < k && k < \result.records.length ==> \result.records[k].start === \result.records[k - 1].start + \result.records[k - 1].length + 4)
  //@ ensures forall(k, 0 <= k && k < \result.records.length ==> 170 <= \result.records[k].start && \result.records[k].start <= bytes.length && \result.records[k].start + \result.records[k].length <= bytes.length && \result.records[k].type === bytes[\result.records[k].start - 4] + bytes[\result.records[k].start - 3] * 256 && \result.records[k].length === bytes[\result.records[k].start - 2] + bytes[\result.records[k].start - 1] * 256)
  //@ ensures forall(k, 0 <= k && k < \result.records.length ==> forall(j, 0 <= j && j < k ==> \result.records[j].type !== \result.records[k].type))
  const records: ExtensionRecord[] = [];
  if (bytes.length <= 165) return { error: 1, at: 166, type: 0, records };
  if (bytes[165] !== accountType) return { error: 2, at: 166, type: 0, records };
  const end = dataEnd(bytes);
  let at = 166;
  while (at < end) {
    //@ invariant 166 <= at && at <= bytes.length
    //@ invariant records.length === 0 ? at === 166 : at === records[records.length - 1].start + records[records.length - 1].length
    //@ invariant records.length > 0 ==> records[0].start === 170
    //@ invariant forall(k, 0 < k && k < records.length ==> records[k].start === records[k - 1].start + records[k - 1].length + 4)
    //@ invariant forall(k, 0 <= k && k < records.length ==> 170 <= records[k].start && records[k].start <= bytes.length && records[k].start + records[k].length <= bytes.length && records[k].type === bytes[records[k].start - 4] + bytes[records[k].start - 3] * 256 && records[k].length === bytes[records[k].start - 2] + bytes[records[k].start - 1] * 256)
    //@ invariant forall(k, 0 <= k && k < records.length ==> forall(j, 0 <= j && j < k ==> records[j].type !== records[k].type))
    //@ assert 0 < end && end <= bytes.length && bytes[end - 1] !== 0
    if (bytes.length - at < 4) return { error: 3, at, type: 0, records };
    const type = u16(bytes, at);
    const length = u16(bytes, at + 2);
    if (hasType(records, type)) return { error: 4, at, type, records };
    if (4 + length > bytes.length - at) return { error: 3, at, type, records };
    records.push({ type, start: at + 4, length });
    at = at + 4 + length;
  }
  return { error: 0, at, type: 0, records };
}

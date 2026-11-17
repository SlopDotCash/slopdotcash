//@ backend dafny
// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"

export interface ZipRecord {
  nameStart: number;
  nameEnd: number;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  fileType: number;
  localOffset: number;
}

export interface ZipDirectory {
  error: number;
  records: ZipRecord[];
}

export interface ZipSpan {
  error: number;
  start: number;
  end: number;
}

export const endSignature = 101010256;
export const centralSignature = 33639248;
export const localSignature = 67324752;
export const maximumUint16 = 65535;
export const maximumUint32 = 4294967295;

//@ pure
export function recordWithin(record: ZipRecord, length: number): boolean {
  return 0 <= record.nameStart && record.nameStart <= record.nameEnd && record.nameEnd <= length &&
    0 <= record.localOffset && 0 <= record.compressedSize && 0 <= record.size && 0 <= record.flags;
}

export function uint16At(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires 0 <= at && at + 2 <= bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result && \result <= 65535
  return bytes[at] + bytes[at + 1] * 256;
}

export function uint32At(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires 0 <= at && at + 4 <= bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result
  const low = uint16At(bytes, at);
  const high = uint16At(bytes, at + 2);
  return low + high * 65536;
}

export function endRecordAt(bytes: Uint8Array): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result == -1 || (0 <= \result && \result + 22 <= bytes.length)
  if (bytes.length < 22) return -1;
  let lowest = 0;
  if (bytes.length - 22 - maximumUint16 > 0) lowest = bytes.length - 22 - maximumUint16;
  let offset = bytes.length - 22;
  while (offset >= lowest) {
    //@ invariant 0 <= lowest && lowest - 1 <= offset && offset + 22 <= bytes.length
    //@ decreases offset - lowest + 1
    const signature = uint32At(bytes, offset);
    if (signature === endSignature) return offset;
    offset = offset - 1;
  }
  return -1;
}

export function directoryRecords(bytes: Uint8Array, end: number): ZipDirectory {
  //@ type bytes number[]
  //@ requires 0 <= end && end + 22 <= bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.records.length < 65535
  //@ ensures forall(k, 0 <= k && k < \result.records.length ==> recordWithin(\result.records[k], bytes.length))
  const records: ZipRecord[] = [];
  const count = uint16At(bytes, end + 10);
  const directorySize = uint32At(bytes, end + 12);
  let at = uint32At(bytes, end + 16);
  if (count === maximumUint16 || directorySize === maximumUint32 || at === maximumUint32 || at + directorySize > end) return { error: 1, records };
  let i = 0;
  while (i < count) {
    //@ invariant 0 <= i && i <= count && count < 65535 && records.length == i && 0 <= at
    //@ invariant forall(k, 0 <= k && k < records.length ==> recordWithin(records[k], bytes.length))
    //@ decreases count - i
    if (at + 46 > end) return { error: 2, records };
    const signature = uint32At(bytes, at);
    if (signature !== centralSignature) return { error: 2, records };
    const nameLength = uint16At(bytes, at + 28);
    const extraLength = uint16At(bytes, at + 30);
    const commentLength = uint16At(bytes, at + 32);
    if (at + 46 + nameLength > end) return { error: 3, records };
    const flags = uint16At(bytes, at + 8);
    const method = uint16At(bytes, at + 10);
    const crc = uint32At(bytes, at + 16);
    const compressedSize = uint32At(bytes, at + 20);
    const size = uint32At(bytes, at + 24);
    const fileType = Math.floor(bytes[at + 41] / 16) * 4096;
    const localOffset = uint32At(bytes, at + 42);
    records.push({ nameStart: at + 46, nameEnd: at + 46 + nameLength, method, flags, crc, compressedSize, size, fileType, localOffset });
    at = at + 46 + nameLength + extraLength + commentLength;
    i = i + 1;
  }
  return { error: 0, records };
}

export function entryData(bytes: Uint8Array, record: ZipRecord): ZipSpan {
  //@ type bytes number[]
  //@ requires recordWithin(record, bytes.length)
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.error == 0 ==> 0 <= \result.start && \result.start <= \result.end && \result.end <= bytes.length && \result.end - \result.start == record.compressedSize
  const local = record.localOffset;
  if (local + 30 > bytes.length) return { error: 1, start: 0, end: 0 };
  const signature = uint32At(bytes, local);
  if (signature !== localSignature) return { error: 1, start: 0, end: 0 };
  const nameLength = uint16At(bytes, local + 26);
  const extraLength = uint16At(bytes, local + 28);
  const start = local + 30 + nameLength + extraLength;
  if (start + record.compressedSize > bytes.length) return { error: 2, start: 0, end: 0 };
  if (record.flags % 2 === 1) return { error: 3, start: 0, end: 0 };
  return { error: 0, start, end: start + record.compressedSize };
}

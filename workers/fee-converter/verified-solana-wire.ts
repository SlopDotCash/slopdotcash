/** Byte spans in the original signed transaction; the wrapper owns decoding/copies. */
export interface WireSpan {
  start: number;
  end: number;
}

export interface WireInstruction {
  program: number;
  accounts: WireSpan;
  data: WireSpan;
}

export interface WireLookup {
  address: WireSpan;
  writable: WireSpan;
  readonly: WireSpan;
}

export interface CompactRead {
  /** 0 complete; 1 truncated; 2 invalid compact length. */
  error: number;
  value: number;
  next: number;
}

/** Preserve the accepted three-byte format, including overlong encodings. */
//@ verify
//@ type bytes number[]
//@ requires 0 <= at && at <= bytes.length
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result == CompactValue(bytes, at, 0, 0, 1)
//@ ensures 0 <= \result.error && \result.error <= 2
//@ ensures \result.error == 0 ==> at < \result.next && \result.next <= bytes.length && \result.next <= at + 3 && 0 <= \result.value && \result.value <= 2097151
function readCompact(bytes: Uint8Array, at: number): CompactRead {
  let value = 0;
  let factor = 1;
  let i = 0;
  while (i < 3) {
    //@ invariant 0 <= i && i <= 3
    //@ invariant factor == Pow128(i)
    //@ invariant 0 <= value && value < factor
    //@ invariant CompactValue(bytes, at, 0, 0, 1) == CompactValue(bytes, at, i, value, factor)
    if (at + i >= bytes.length) return { error: 1, value: 0, next: at };
    const byte = bytes[at + i];
    value += (byte % 128) * factor;
    if (byte < 128) return { error: 0, value, next: at + i + 1 };
    factor *= 128;
    i += 1;
  }
  return { error: 2, value: 0, next: at };
}

export interface WireInstructionScan {
  error: number;
  next: number;
  records: WireInstruction[];
}

export interface WireLookupScan {
  error: number;
  next: number;
  records: WireLookup[];
}

//@ verify
//@ type bytes number[]
//@ requires 0 <= start && start <= bytes.length && count >= 0 && keyCount >= 0
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result == InstructionTail(bytes, start, count, keyCount)
//@ ensures \result.error == 0 || \result.error == 1 || \result.error == 2 || \result.error == 6
//@ ensures 0 <= \result.next && \result.next <= bytes.length
//@ ensures \result.error == 0 ==> \result.records.length == count
//@ ensures forall(i, 0 <= i && i < \result.records.length ==> ValidWireInstruction(\result.records[i], bytes.length, keyCount))
function scanInstructions(
  bytes: Uint8Array,
  start: number,
  count: number,
  keyCount: number,
): WireInstructionScan {
  const records: WireInstruction[] = [];
  let at = start;
  let i = 0;
  while (i < count) {
    //@ invariant 0 <= i && i <= count && start <= at && at <= bytes.length
    //@ invariant records.length == i
    //@ invariant forall(k, 0 <= k && k < records.length ==> ValidWireInstruction(records[k], bytes.length, keyCount))
    //@ invariant InstructionTail(bytes, start, count, keyCount) == PrependInstructions(records, InstructionTail(bytes, at, count - i, keyCount))
    if (at >= bytes.length) return { error: 1, next: at, records };
    const program = bytes[at];
    at += 1;
    if (program >= keyCount) return { error: 6, next: at, records };
    const accountsLength = readCompact(bytes, at);
    if (accountsLength.error !== 0)
      return { error: accountsLength.error, next: at, records };
    at = accountsLength.next;
    const accountsStart = at;
    if (accountsLength.value > bytes.length - at)
      return { error: 1, next: at, records };
    at += accountsLength.value;
    const accountsEnd = at;
    const dataLength = readCompact(bytes, at);
    if (dataLength.error !== 0)
      return { error: dataLength.error, next: at, records };
    at = dataLength.next;
    const dataStart = at;
    if (dataLength.value > bytes.length - at)
      return { error: 1, next: at, records };
    at += dataLength.value;
    records.push({
      program,
      accounts: { start: accountsStart, end: accountsEnd },
      data: { start: dataStart, end: at },
    });
    i += 1;
  }
  return { error: 0, next: at, records };
}

//@ verify
//@ type bytes number[]
//@ requires 0 <= start && start <= bytes.length && count >= 0
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result == LookupTail(bytes, start, count)
//@ ensures 0 <= \result.error && \result.error <= 2
//@ ensures forall(i, 0 <= i && i < \result.records.length ==> ValidWireLookup(\result.records[i], bytes.length))
//@ ensures 0 <= \result.next && \result.next <= bytes.length
//@ ensures \result.error == 0 ==> \result.records.length == count
function scanLookups(
  bytes: Uint8Array,
  start: number,
  count: number,
): WireLookupScan {
  const records: WireLookup[] = [];
  let at = start;
  let i = 0;
  while (i < count) {
    //@ invariant 0 <= i && i <= count && start <= at && at <= bytes.length
    //@ invariant records.length == i
    //@ invariant forall(k, 0 <= k && k < records.length ==> ValidWireLookup(records[k], bytes.length))
    //@ invariant LookupTail(bytes, start, count) == PrependLookups(records, LookupTail(bytes, at, count - i))
    if (32 > bytes.length - at) return { error: 1, next: at, records };
    const addressStart = at;
    at += 32;
    const addressEnd = at;
    const writableLength = readCompact(bytes, at);
    if (writableLength.error !== 0)
      return { error: writableLength.error, next: at, records };
    at = writableLength.next;
    const writableStart = at;
    if (writableLength.value > bytes.length - at)
      return { error: 1, next: at, records };
    at += writableLength.value;
    const writableEnd = at;
    const readonlyLength = readCompact(bytes, at);
    if (readonlyLength.error !== 0)
      return { error: readonlyLength.error, next: at, records };
    at = readonlyLength.next;
    const readonlyStart = at;
    if (readonlyLength.value > bytes.length - at)
      return { error: 1, next: at, records };
    at += readonlyLength.value;
    records.push({
      address: { start: addressStart, end: addressEnd },
      writable: { start: writableStart, end: writableEnd },
      readonly: { start: readonlyStart, end: at },
    });
    i += 1;
  }
  return { error: 0, next: at, records };
}

//@ verify
//@ ensures \result == LookupAccountCount(records)
//@ ensures forall(i, 0 <= i && i < records.length ==> records[i].writable.start <= records[i].writable.end && records[i].readonly.start <= records[i].readonly.end) ==> \result >= 0
function lookupAccountCount(records: readonly WireLookup[]): number {
  let total = 0;
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant total == LookupAccountCount(records.slice(0, i))
    //@ invariant forall(k, 0 <= k && k < records.length ==> records[k].writable.start <= records[k].writable.end && records[k].readonly.start <= records[k].readonly.end) ==> total >= 0
    total +=
      records[i].writable.end -
      records[i].writable.start +
      records[i].readonly.end -
      records[i].readonly.start;
    i += 1;
  }
  return total;
}

//@ verify
//@ type bytes number[]
//@ requires forall(i, 0 <= i && i < instructions.length ==> 0 <= instructions[i].accounts.start && instructions[i].accounts.start <= instructions[i].accounts.end && instructions[i].accounts.end <= bytes.length)
//@ ensures \result <==> ValidInstructionAccounts(bytes, instructions, total)
function accountsBelow(
  bytes: Uint8Array,
  instructions: readonly WireInstruction[],
  total: number,
): boolean {
  let i = 0;
  while (i < instructions.length) {
    //@ invariant 0 <= i && i <= instructions.length
    //@ invariant forall(k, 0 <= k && k < i ==> AllBelow(bytes, instructions[k].accounts, total))
    let at = instructions[i].accounts.start;
    while (at < instructions[i].accounts.end) {
      //@ invariant instructions[i].accounts.start <= at && at <= instructions[i].accounts.end
      //@ invariant forall(k, instructions[i].accounts.start <= k && k < at ==> bytes[k] < total)
      if (bytes[at] >= total) return false;
      at += 1;
    }
    i += 1;
  }
  return true;
}

export interface WireTransaction {
  signatureCount: number;
  messageOffset: number;
  requiredSignatures: number;
  readonlySigned: number;
  readonlyUnsigned: number;
  staticStart: number;
  keyCount: number;
  blockhashOffset: number;
  legacy: boolean;
  instructions: WireInstruction[];
  lookups: WireLookup[];
}

export type WireParse =
  | { kind: "failure"; error: number }
  | { kind: "transaction"; value: WireTransaction };

/** Full signed legacy/v0 wire parser. It reads native bytes and returns their spans. */
//@ verify
//@ type bytes number[]
//@ requires bytes.length <= 9007199254740991
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures \result == SignedTransaction(bytes)
//@ ensures \result.kind == "failure" ==> 1 <= \result.error && \result.error <= 7
//@ ensures \result.kind == "transaction" ==> ValidWireTransaction(bytes, \result.value)
export function parseSolanaWire(bytes: Uint8Array): WireParse {
  const signatures = readCompact(bytes, 0);
  if (signatures.error !== 0)
    return { kind: "failure", error: signatures.error };
  const signatureCount = signatures.value;
  const messageOffset = signatures.next + signatureCount * 64;
  if (messageOffset >= bytes.length || bytes.length > 1232)
    return { kind: "failure", error: 3 };
  let at = messageOffset;
  const legacy = bytes[at] < 128;
  if (!legacy) {
    const version = bytes[at];
    at += 1;
    if (version !== 128) return { kind: "failure", error: 4 };
  }
  if (3 > bytes.length - at) return { kind: "failure", error: 1 };
  const requiredSignatures = bytes[at];
  const readonlySigned = bytes[at + 1];
  const readonlyUnsigned = bytes[at + 2];
  at += 3;
  const keys = readCompact(bytes, at);
  if (keys.error !== 0) return { kind: "failure", error: keys.error };
  at = keys.next;
  const keyCount = keys.value;
  if (
    keyCount < requiredSignatures ||
    signatureCount !== requiredSignatures ||
    readonlySigned > requiredSignatures ||
    readonlyUnsigned > keyCount - requiredSignatures
  )
    return { kind: "failure", error: 5 };
  const staticStart = at;
  if (keyCount * 32 > bytes.length - at) return { kind: "failure", error: 1 };
  at += keyCount * 32;
  const blockhashOffset = at;
  if (32 > bytes.length - at) return { kind: "failure", error: 1 };
  at += 32;
  const count = readCompact(bytes, at);
  if (count.error !== 0) return { kind: "failure", error: count.error };
  const instructionScan = scanInstructions(
    bytes,
    count.next,
    count.value,
    keyCount,
  );
  if (instructionScan.error !== 0)
    return { kind: "failure", error: instructionScan.error };
  at = instructionScan.next;
  let lookups: WireLookup[] = [];
  if (!legacy) {
    const lookupCount = readCompact(bytes, at);
    if (lookupCount.error !== 0)
      return { kind: "failure", error: lookupCount.error };
    const scan = scanLookups(bytes, lookupCount.next, lookupCount.value);
    if (scan.error !== 0) return { kind: "failure", error: scan.error };
    at = scan.next;
    lookups = scan.records;
  }
  const total = keyCount + lookupAccountCount(lookups);
  if (
    at !== bytes.length ||
    total > 256 ||
    !accountsBelow(bytes, instructionScan.records, total)
  )
    return { kind: "failure", error: 7 };
  return {
    kind: "transaction",
    value: {
      signatureCount,
      messageOffset,
      requiredSignatures,
      readonlySigned,
      readonlyUnsigned,
      staticStart,
      keyCount,
      blockhashOffset,
      legacy,
      instructions: instructionScan.records,
      lookups,
    },
  };
}

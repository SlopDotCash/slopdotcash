//@ backend dafny
// spec/fees/conversion.md, "An unknown send is rebroadcast unchanged; only proven expiry retires it"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"

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
  error: number;
  value: number;
  next: number;
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

export const maximumWireBytes = 1232;
export const maximumWireAccounts = 256;

//@ pure
export function spanWithin(span: WireSpan, length: number): boolean {
  return 0 <= span.start && span.start <= span.end && span.end <= length;
}

//@ pure
export function validInstruction(record: WireInstruction, length: number, keyCount: number): boolean {
  return 0 <= record.program && record.program < keyCount && spanWithin(record.accounts, length) && spanWithin(record.data, length);
}

//@ pure
export function validLookup(record: WireLookup, length: number): boolean {
  return spanWithin(record.address, length) && record.address.end - record.address.start === 32 && spanWithin(record.writable, length) && spanWithin(record.readonly, length);
}

//@ pure
export function lookupAccounts(records: readonly WireLookup[], count: number): number {
  //@ requires 0 <= count && count <= records.length
  //@ requires forall(i, 0 <= i && i < records.length ==> records[i].writable.start <= records[i].writable.end && records[i].readonly.start <= records[i].readonly.end)
  //@ ensures \result >= 0
  //@ decreases count
  if (count === 0) return 0;
  const record = records[count - 1];
  return lookupAccounts(records, count - 1) + (record.writable.end - record.writable.start) + (record.readonly.end - record.readonly.start);
}

export function readCompact(bytes: Uint8Array, at: number): CompactRead {
  //@ type bytes number[]
  //@ requires 0 <= at && at <= bytes.length
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result.error && \result.error <= 2
  //@ ensures \result.error != 0 ==> \result.next == at && \result.value == 0
  //@ ensures \result.error == 0 ==> at < \result.next && \result.next <= bytes.length && \result.next <= at + 3 && 0 <= \result.value && \result.value <= 2097151
  let value = 0;
  let factor = 1;
  let i = 0;
  while (i < 3) {
    //@ invariant 0 <= i && i <= 3
    //@ invariant (i == 0 && factor == 1) || (i == 1 && factor == 128) || (i == 2 && factor == 16384) || (i == 3 && factor == 2097152)
    //@ invariant 0 <= value && value < factor
    //@ decreases 3 - i
    if (at + i >= bytes.length) return { error: 1, value: 0, next: at };
    const byte = bytes[at + i];
    value += (byte % 128) * factor;
    if (byte < 128) return { error: 0, value, next: at + i + 1 };
    factor *= 128;
    i += 1;
  }
  return { error: 2, value: 0, next: at };
}

export function scanInstructions(bytes: Uint8Array, start: number, count: number, keyCount: number): WireInstructionScan {
  //@ type bytes number[]
  //@ requires 0 <= start && start <= bytes.length && count >= 0 && keyCount >= 0
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.error == 0 || \result.error == 1 || \result.error == 2 || \result.error == 6
  //@ ensures start <= \result.next && \result.next <= bytes.length
  //@ ensures \result.error == 0 ==> \result.records.length == count
  //@ ensures forall(i, 0 <= i && i < \result.records.length ==> validInstruction(\result.records[i], bytes.length, keyCount))
  const records: WireInstruction[] = [];
  let at = start;
  let i = 0;
  while (i < count) {
    //@ invariant 0 <= i && i <= count && start <= at && at <= bytes.length
    //@ invariant records.length == i
    //@ invariant forall(k, 0 <= k && k < records.length ==> validInstruction(records[k], bytes.length, keyCount))
    if (at >= bytes.length) return { error: 1, next: at, records };
    const program = bytes[at];
    at += 1;
    if (program >= keyCount) return { error: 6, next: at, records };
    const accountsLength = readCompact(bytes, at);
    if (accountsLength.error !== 0) return { error: accountsLength.error, next: at, records };
    at = accountsLength.next;
    const accountsStart = at;
    if (accountsLength.value > bytes.length - at) return { error: 1, next: at, records };
    at += accountsLength.value;
    const accountsEnd = at;
    const dataLength = readCompact(bytes, at);
    if (dataLength.error !== 0) return { error: dataLength.error, next: at, records };
    at = dataLength.next;
    const dataStart = at;
    if (dataLength.value > bytes.length - at) return { error: 1, next: at, records };
    at += dataLength.value;
    records.push({ program, accounts: { start: accountsStart, end: accountsEnd }, data: { start: dataStart, end: at } });
    i += 1;
  }
  return { error: 0, next: at, records };
}

export function scanLookups(bytes: Uint8Array, start: number, count: number): WireLookupScan {
  //@ type bytes number[]
  //@ requires 0 <= start && start <= bytes.length && count >= 0
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures 0 <= \result.error && \result.error <= 2
  //@ ensures start <= \result.next && \result.next <= bytes.length
  //@ ensures \result.error == 0 ==> \result.records.length == count
  //@ ensures forall(i, 0 <= i && i < \result.records.length ==> validLookup(\result.records[i], bytes.length))
  const records: WireLookup[] = [];
  let at = start;
  let i = 0;
  while (i < count) {
    //@ invariant 0 <= i && i <= count && start <= at && at <= bytes.length
    //@ invariant records.length == i
    //@ invariant forall(k, 0 <= k && k < records.length ==> validLookup(records[k], bytes.length))
    if (32 > bytes.length - at) return { error: 1, next: at, records };
    const addressStart = at;
    at += 32;
    const addressEnd = at;
    const writableLength = readCompact(bytes, at);
    if (writableLength.error !== 0) return { error: writableLength.error, next: at, records };
    at = writableLength.next;
    const writableStart = at;
    if (writableLength.value > bytes.length - at) return { error: 1, next: at, records };
    at += writableLength.value;
    const writableEnd = at;
    const readonlyLength = readCompact(bytes, at);
    if (readonlyLength.error !== 0) return { error: readonlyLength.error, next: at, records };
    at = readonlyLength.next;
    const readonlyStart = at;
    if (readonlyLength.value > bytes.length - at) return { error: 1, next: at, records };
    at += readonlyLength.value;
    records.push({ address: { start: addressStart, end: addressEnd }, writable: { start: writableStart, end: writableEnd }, readonly: { start: readonlyStart, end: at } });
    i += 1;
  }
  return { error: 0, next: at, records };
}

export function accountsBelow(bytes: Uint8Array, instructions: readonly WireInstruction[], total: number): boolean {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < instructions.length ==> spanWithin(instructions[i].accounts, bytes.length))
  //@ ensures \result <==> forall(i, 0 <= i && i < instructions.length ==> forall(k, instructions[i].accounts.start <= k && k < instructions[i].accounts.end ==> bytes[k] < total))
  let i = 0;
  while (i < instructions.length) {
    //@ invariant 0 <= i && i <= instructions.length
    //@ invariant forall(j, 0 <= j && j < i ==> forall(k, instructions[j].accounts.start <= k && k < instructions[j].accounts.end ==> bytes[k] < total))
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

export function parseSolanaWire(bytes: Uint8Array): WireParse {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == "failure" ==> 1 <= \result.error && \result.error <= 7
  //@ ensures \result.kind == "transaction" ==> bytes.length <= 1232 && \result.value.messageOffset < bytes.length && \result.value.signatureCount == \result.value.requiredSignatures && \result.value.readonlySigned <= \result.value.requiredSignatures && \result.value.requiredSignatures <= \result.value.keyCount && \result.value.readonlyUnsigned <= \result.value.keyCount - \result.value.requiredSignatures
  //@ ensures \result.kind == "transaction" ==> \result.value.messageOffset < \result.value.staticStart && \result.value.staticStart + \result.value.keyCount * 32 == \result.value.blockhashOffset && \result.value.blockhashOffset + 32 <= bytes.length
  //@ ensures \result.kind == "transaction" ==> (\result.value.legacy ==> \result.value.lookups.length == 0)
  //@ ensures \result.kind == "transaction" ==> forall(i, 0 <= i && i < \result.value.instructions.length ==> validInstruction(\result.value.instructions[i], bytes.length, \result.value.keyCount))
  //@ ensures \result.kind == "transaction" ==> forall(i, 0 <= i && i < \result.value.lookups.length ==> validLookup(\result.value.lookups[i], bytes.length))
  //@ ensures \result.kind == "transaction" ==> \result.value.keyCount + lookupAccounts(\result.value.lookups, \result.value.lookups.length) <= 256
  //@ ensures \result.kind == "transaction" ==> forall(i, 0 <= i && i < \result.value.instructions.length ==> forall(k, \result.value.instructions[i].accounts.start <= k && k < \result.value.instructions[i].accounts.end ==> bytes[k] < \result.value.keyCount + lookupAccounts(\result.value.lookups, \result.value.lookups.length)))
  const signatures = readCompact(bytes, 0);
  if (signatures.error !== 0) return { kind: "failure", error: signatures.error };
  const signatureCount = signatures.value;
  const messageOffset = signatures.next + signatureCount * 64;
  if (messageOffset >= bytes.length || bytes.length > maximumWireBytes) return { kind: "failure", error: 3 };
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
  if (keyCount < requiredSignatures || signatureCount !== requiredSignatures || readonlySigned > requiredSignatures || readonlyUnsigned > keyCount - requiredSignatures) return { kind: "failure", error: 5 };
  const staticStart = at;
  if (keyCount * 32 > bytes.length - at) return { kind: "failure", error: 1 };
  at += keyCount * 32;
  const blockhashOffset = at;
  if (32 > bytes.length - at) return { kind: "failure", error: 1 };
  at += 32;
  const count = readCompact(bytes, at);
  if (count.error !== 0) return { kind: "failure", error: count.error };
  const instructionScan = scanInstructions(bytes, count.next, count.value, keyCount);
  if (instructionScan.error !== 0) return { kind: "failure", error: instructionScan.error };
  at = instructionScan.next;
  let lookups: WireLookup[] = [];
  if (!legacy) {
    const lookupCount = readCompact(bytes, at);
    if (lookupCount.error !== 0) return { kind: "failure", error: lookupCount.error };
    const scan = scanLookups(bytes, lookupCount.next, lookupCount.value);
    if (scan.error !== 0) return { kind: "failure", error: scan.error };
    at = scan.next;
    lookups = scan.records;
  }
  const total = keyCount + lookupAccounts(lookups, lookups.length);
  if (at !== bytes.length || total > maximumWireAccounts || !accountsBelow(bytes, instructionScan.records, total)) return { kind: "failure", error: 7 };
  return {
    kind: "transaction",
    value: { signatureCount, messageOffset, requiredSignatures, readonlySigned, readonlyUnsigned, staticStart, keyCount, blockhashOffset, legacy, instructions: instructionScan.records, lookups },
  };
}

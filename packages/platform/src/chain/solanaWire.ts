// spec/settlement/solanaScan.md, "A fresh scan invocation verifies the selected endpoint's network"; spec/settlement/solanaScan.md, "Stale or partial work leaves the authoritative prefix intact"
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import { Schema } from "effect";

export type Address = string & { readonly __brand: "SolanaAddress" };
export type Blockhash = string & { readonly __brand: "SolanaBlockhash" };
export type Signature = string & { readonly __brand: "SolanaSignature" };

export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
export const MAX_TRANSACTION_BYTES = 1232;

/** @throws {never} */
export function base58Encode(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

/** @throws {never} */
export function base58Decode(text: string): Uint8Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(text);
  } catch {
    return undefined;
  }
  return base58.encode(bytes) === text ? bytes : undefined;
}

/** @throws {never} */
export function base64Encode(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

/** @throws {never} */
export function base64Decode(text: string): Uint8Array | undefined {
  try {
    return base64.decode(text);
  } catch {
    return undefined;
  }
}

function sized(text: string, length: number): Uint8Array | undefined {
  const bytes = base58Decode(text);
  return bytes?.length === length ? bytes : undefined;
}

/** @throws {never} */
export function publicKey(text: string): Uint8Array | undefined {
  return sized(text, 32);
}

/** @throws {never} */
export function isAddress(text: string): text is Address {
  return publicKey(text) !== undefined;
}

/** @throws {never} */
export function address(text: string): Address | undefined {
  return isAddress(text) ? text : undefined;
}

/** @throws {never} */
export function addressOf(bytes: Uint8Array): Address | undefined {
  return bytes.length === 32 ? (base58.encode(bytes) as Address) : undefined;
}

/** @throws {never} */
export function isBlockhash(text: string): text is Blockhash {
  return sized(text, 32) !== undefined;
}

/** @throws {never} */
export function isSignature(text: string): text is Signature {
  return sized(text, 64) !== undefined;
}

/** @throws {never} */
export function signatureOf(bytes: Uint8Array): Signature | undefined {
  return bytes.length === 64 ? (base58.encode(bytes) as Signature) : undefined;
}

/** @throws {never} */
export function onCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes, true);
    return true;
  } catch {
    return false;
  }
}

const pdaMarker = new TextEncoder().encode("ProgramDerivedAddress");

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export interface ProgramAddress {
  readonly address: Address;
  readonly bump: number;
}

/** @throws {never} */
export function findPda(seeds: ReadonlyArray<Uint8Array>, programId: Address): ProgramAddress | undefined {
  const program = publicKey(programId);
  if (program === undefined || seeds.length > 15 || seeds.some((seed) => seed.length > 32)) return undefined;
  for (let bump = 255; bump >= 0; bump--) {
    const candidate = sha256(concat([...seeds, Uint8Array.of(bump), program, pdaMarker]));
    if (!onCurve(candidate)) return { address: base58.encode(candidate) as Address, bump };
  }
  return undefined;
}

/** @throws {never} */
export function associatedTokenAddress(owner: Address, mint: Address, tokenProgram: Address): Address | undefined {
  const seeds = [owner, tokenProgram, mint].map(publicKey);
  if (seeds.some((seed) => seed === undefined)) return undefined;
  return findPda(seeds as ReadonlyArray<Uint8Array>, ASSOCIATED_TOKEN_PROGRAM)?.address;
}

export type WireIssue =
  | "truncated"
  | "invalidCompactLength"
  | "tooLarge"
  | "unsupportedVersion"
  | "invalidSignerHeader"
  | "programOutsideStaticKeys"
  | "accountIndexOutOfRange"
  | "trailingBytes"
  | "notEncodable";

export interface MessageHeader {
  readonly requiredSignatures: number;
  readonly readonlySigned: number;
  readonly readonlyUnsigned: number;
}

export interface CompiledInstruction {
  readonly programIndex: number;
  readonly accounts: ReadonlyArray<number>;
  readonly data: Uint8Array;
}

export interface AddressTableLookup {
  readonly table: Address;
  readonly writableIndexes: ReadonlyArray<number>;
  readonly readonlyIndexes: ReadonlyArray<number>;
}

interface MessageBody {
  readonly header: MessageHeader;
  readonly accountKeys: ReadonlyArray<Address>;
  readonly recentBlockhash: Blockhash;
  readonly instructions: ReadonlyArray<CompiledInstruction>;
}

export type Message =
  | (MessageBody & { readonly version: "legacy" })
  | (MessageBody & { readonly version: 0; readonly lookups: ReadonlyArray<AddressTableLookup> });

export interface Transaction {
  readonly signatures: ReadonlyArray<Uint8Array>;
  readonly message: Message;
}

export interface DecodedTransaction extends Transaction {
  readonly messageBytes: Uint8Array;
}

export type Decoded<A, I> = { readonly kind: "decoded"; readonly value: A } | { readonly kind: "malformed"; readonly issue: I };

class Malformed<I> extends Error {
  readonly issue: I;
  constructor(issue: I) {
    super("malformed wire bytes");
    this.issue = issue;
  }
}

function decodedBy<A, I>(read: () => A): Decoded<A, I> {
  try {
    return { kind: "decoded", value: read() };
  } catch (error) {
    if (error instanceof Malformed) return { kind: "malformed", issue: error.issue as I };
    throw error;
  }
}

class Cursor {
  at = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  take(length: number): Uint8Array {
    if (length > this.bytes.length - this.at) throw new Malformed<WireIssue>("truncated");
    const part = this.bytes.slice(this.at, this.at + length);
    this.at += length;
    return part;
  }

  byte(): number {
    return this.take(1)[0];
  }

  compact(): number {
    let value = 0;
    for (let index = 0; index < 3; index++) {
      const byte = this.byte();
      value |= (byte & 0x7f) << (7 * index);
      if ((byte & 0x80) === 0) {
        if ((index > 0 && byte === 0) || value > 0xffff) throw new Malformed<WireIssue>("invalidCompactLength");
        return value;
      }
    }
    throw new Malformed<WireIssue>("invalidCompactLength");
  }

  list<A>(read: () => A): A[] {
    return Array.from({ length: this.compact() }, read);
  }

  key(): Address {
    return base58.encode(this.take(32)) as Address;
  }
}

function readMessage(cursor: Cursor): Message {
  const prefix = cursor.bytes[cursor.at] ?? 0;
  const versioned = (prefix & 0x80) !== 0;
  if (versioned && cursor.byte() !== 0x80) throw new Malformed<WireIssue>("unsupportedVersion");
  const header = { requiredSignatures: cursor.byte(), readonlySigned: cursor.byte(), readonlyUnsigned: cursor.byte() };
  const accountKeys = cursor.list(() => cursor.key());
  if (accountKeys.length < header.requiredSignatures || header.readonlySigned > header.requiredSignatures || header.readonlyUnsigned > accountKeys.length - header.requiredSignatures)
    throw new Malformed<WireIssue>("invalidSignerHeader");
  const recentBlockhash = base58.encode(cursor.take(32)) as Blockhash;
  const instructions = cursor.list((): CompiledInstruction => {
    const programIndex = cursor.byte();
    if (programIndex >= accountKeys.length) throw new Malformed<WireIssue>("programOutsideStaticKeys");
    const accounts = [...cursor.take(cursor.compact())];
    return { programIndex, accounts, data: cursor.take(cursor.compact()) };
  });
  const lookups = versioned
    ? cursor.list((): AddressTableLookup => ({ table: cursor.key(), writableIndexes: [...cursor.take(cursor.compact())], readonlyIndexes: [...cursor.take(cursor.compact())] }))
    : [];
  const total = lookups.reduce((sum, lookup) => sum + lookup.writableIndexes.length + lookup.readonlyIndexes.length, accountKeys.length);
  if (total > 256 || instructions.some((instruction) => instruction.accounts.some((index) => index >= total))) throw new Malformed<WireIssue>("accountIndexOutOfRange");
  const body = { header, accountKeys, recentBlockhash, instructions };
  return versioned ? { ...body, version: 0, lookups } : { ...body, version: "legacy" };
}

function finished(cursor: Cursor): void {
  if (cursor.at !== cursor.bytes.length) throw new Malformed<WireIssue>("trailingBytes");
}

/** @throws {never} */
export function decodeMessage(bytes: Uint8Array): Decoded<Message, WireIssue> {
  return decodedBy(() => {
    const cursor = new Cursor(bytes);
    const message = readMessage(cursor);
    finished(cursor);
    return message;
  });
}

/** @throws {never} */
export function decodeTransaction(bytes: Uint8Array): Decoded<DecodedTransaction, WireIssue> {
  return decodedBy(() => {
    if (bytes.length > MAX_TRANSACTION_BYTES) throw new Malformed<WireIssue>("tooLarge");
    const cursor = new Cursor(bytes);
    const signatures = cursor.list(() => cursor.take(64));
    const start = cursor.at;
    const message = readMessage(cursor);
    finished(cursor);
    if (signatures.length !== message.header.requiredSignatures) throw new Malformed<WireIssue>("invalidSignerHeader");
    return { signatures, message, messageBytes: bytes.slice(start) };
  });
}

class Writer {
  readonly parts: Uint8Array[] = [];

  byte(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Malformed<WireIssue>("notEncodable");
    this.parts.push(Uint8Array.of(value));
  }

  compact(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Malformed<WireIssue>("notEncodable");
    let rest = value;
    do {
      const low = rest & 0x7f;
      rest >>>= 7;
      this.byte(rest === 0 ? low : low | 0x80);
    } while (rest !== 0);
  }

  fixed(bytes: Uint8Array | undefined, length: number): void {
    if (bytes?.length !== length) throw new Malformed<WireIssue>("notEncodable");
    this.parts.push(bytes);
  }

  bytes(bytes: Uint8Array | ReadonlyArray<number>): void {
    this.compact(bytes.length);
    for (const value of bytes) this.byte(value);
  }

  list<A>(items: ReadonlyArray<A>, write: (item: A) => void): void {
    this.compact(items.length);
    for (const item of items) write(item);
  }
}

function writeMessage(writer: Writer, message: Message): void {
  if (message.version === 0) writer.byte(0x80);
  writer.byte(message.header.requiredSignatures);
  writer.byte(message.header.readonlySigned);
  writer.byte(message.header.readonlyUnsigned);
  writer.list(message.accountKeys, (key) => writer.fixed(publicKey(key), 32));
  writer.fixed(sized(message.recentBlockhash, 32), 32);
  writer.list(message.instructions, (instruction) => {
    writer.byte(instruction.programIndex);
    writer.bytes(instruction.accounts);
    writer.bytes(instruction.data);
  });
  if (message.version === 0)
    writer.list(message.lookups, (lookup) => {
      writer.fixed(publicKey(lookup.table), 32);
      writer.bytes(lookup.writableIndexes);
      writer.bytes(lookup.readonlyIndexes);
    });
}

function encodedBy(write: (writer: Writer) => void): Uint8Array | undefined {
  const writer = new Writer();
  const outcome = decodedBy<void, WireIssue>(() => write(writer));
  return outcome.kind === "decoded" ? concat(writer.parts) : undefined;
}

/** @throws {never} */
export function encodeMessage(message: Message): Uint8Array | undefined {
  return encodedBy((writer) => writeMessage(writer, message));
}

/** @throws {never} */
export function encodeTransaction(transaction: Transaction): Uint8Array | undefined {
  return encodedBy((writer) => {
    writer.list(transaction.signatures, (signature) => writer.fixed(signature, 64));
    writeMessage(writer, transaction.message);
  });
}

export type TokenIssue = "truncated" | "invalidOption" | "basePadding" | "accountTypeMismatch" | "uninitializedExtension" | "truncatedExtension";

export interface TokenExtension {
  readonly type: number;
  readonly length: number;
  readonly bytes: Uint8Array;
}

export interface MintAccount {
  readonly mintAuthority: Address | undefined;
  readonly supply: bigint;
  readonly decimals: number;
  readonly initialized: boolean;
  readonly freezeAuthority: Address | undefined;
  readonly accountType: number | undefined;
  readonly extensions: ReadonlyArray<TokenExtension>;
}

export interface TokenAccount {
  readonly mint: Address;
  readonly owner: Address;
  readonly amount: bigint;
  readonly delegate: Address | undefined;
  readonly state: number;
  readonly isNative: bigint | undefined;
  readonly delegatedAmount: bigint;
  readonly closeAuthority: Address | undefined;
  readonly accountType: number | undefined;
  readonly extensions: ReadonlyArray<TokenExtension>;
}

const MINT_SIZE = 82;
const ACCOUNT_SIZE = 165;
const MINT_ACCOUNT_TYPE = 1;
const TOKEN_ACCOUNT_TYPE = 2;

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function u64(data: Uint8Array, at: number): bigint {
  return view(data).getBigUint64(at, true);
}

function optional<A>(data: Uint8Array, at: number, read: (from: number) => A): A | undefined {
  const tag = view(data).getUint32(at, true);
  if (tag === 0) return undefined;
  if (tag !== 1) throw new Malformed<TokenIssue>("invalidOption");
  return read(at + 4);
}

function key(data: Uint8Array, at: number): Address {
  return base58.encode(data.slice(at, at + 32)) as Address;
}

function extended(data: Uint8Array, baseSize: number, expectedType: number): { accountType: number | undefined; extensions: TokenExtension[] } {
  if (data.length === baseSize) return { accountType: undefined, extensions: [] };
  if (data.length <= ACCOUNT_SIZE) throw new Malformed<TokenIssue>("truncated");
  if (data[ACCOUNT_SIZE] !== expectedType) throw new Malformed<TokenIssue>("accountTypeMismatch");
  const extensions: TokenExtension[] = [];
  let at = ACCOUNT_SIZE + 1;
  while (at < data.length && data.subarray(at).some((byte) => byte !== 0)) {
    if (data.length - at < 4) throw new Malformed<TokenIssue>("truncatedExtension");
    const type = view(data).getUint16(at, true);
    const length = view(data).getUint16(at + 2, true);
    if (type === 0) throw new Malformed<TokenIssue>("uninitializedExtension");
    if (length > data.length - at - 4) throw new Malformed<TokenIssue>("truncatedExtension");
    extensions.push({ type, length, bytes: data.slice(at + 4, at + 4 + length) });
    at += 4 + length;
  }
  return { accountType: expectedType, extensions };
}

/** @throws {never} */
export function decodeMint(data: Uint8Array): Decoded<MintAccount, TokenIssue> {
  return decodedBy(() => {
    if (data.length < MINT_SIZE) throw new Malformed<TokenIssue>("truncated");
    if (data.subarray(MINT_SIZE, ACCOUNT_SIZE).some((byte) => byte !== 0)) throw new Malformed<TokenIssue>("basePadding");
    return {
      mintAuthority: optional(data, 0, (at) => key(data, at)),
      supply: u64(data, 36),
      decimals: data[44],
      initialized: data[45] === 1,
      freezeAuthority: optional(data, 46, (at) => key(data, at)),
      ...extended(data, MINT_SIZE, MINT_ACCOUNT_TYPE),
    };
  });
}

/** @throws {never} */
export function decodeTokenAccount(data: Uint8Array): Decoded<TokenAccount, TokenIssue> {
  return decodedBy(() => {
    if (data.length < ACCOUNT_SIZE) throw new Malformed<TokenIssue>("truncated");
    return {
      mint: key(data, 0),
      owner: key(data, 32),
      amount: u64(data, 64),
      delegate: optional(data, 72, (at) => key(data, at)),
      state: data[108],
      isNative: optional(data, 109, (at) => u64(data, at)),
      delegatedAmount: u64(data, 121),
      closeAuthority: optional(data, 129, (at) => key(data, at)),
      ...extended(data, ACCOUNT_SIZE, TOKEN_ACCOUNT_TYPE),
    };
  });
}

const OptionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Number));

function slotted<S extends Schema.Constraint>(value: S) {
  return Schema.Struct({ context: Schema.Struct({ slot: Schema.Number }), value });
}

export const RpcAccount = Schema.Struct({
  owner: Schema.String,
  lamports: Schema.Number,
  data: Schema.Array(Schema.String),
  executable: Schema.Boolean,
});

export const RpcAccountReply = slotted(Schema.NullOr(RpcAccount));
export const RpcAccountsReply = slotted(Schema.Array(Schema.NullOr(RpcAccount)));
export const RpcProgramAccounts = Schema.Array(Schema.Struct({ pubkey: Schema.String, account: RpcAccount }));
export const RpcBlockhashReply = slotted(Schema.Struct({ blockhash: Schema.String, lastValidBlockHeight: Schema.Number }));
export const RpcValidReply = slotted(Schema.Boolean);
export const RpcFeeReply = slotted(Schema.NullOr(Schema.Number));

export const RpcBlock = Schema.NullOr(Schema.Struct({
  blockhash: Schema.String,
  previousBlockhash: Schema.String,
  parentSlot: Schema.Number,
  blockHeight: OptionalNumber,
  blockTime: OptionalNumber,
}));

export const RpcSignatureEntries = Schema.Array(Schema.Struct({
  signature: Schema.String,
  slot: Schema.Number,
  err: Schema.Unknown,
  blockTime: OptionalNumber,
}));

export const RpcStatusesReply = slotted(Schema.Array(Schema.NullOr(Schema.Struct({
  slot: Schema.Number,
  confirmations: OptionalNumber,
  err: Schema.Unknown,
  confirmationStatus: Schema.optionalKey(Schema.NullOr(Schema.Literals(["processed", "confirmed", "finalized"]))),
}))));

const RpcTokenBalance = Schema.Struct({
  accountIndex: Schema.Number,
  mint: Schema.String,
  owner: Schema.optionalKey(Schema.String),
  programId: Schema.optionalKey(Schema.String),
  uiTokenAmount: Schema.Struct({ amount: Schema.String, decimals: Schema.Number }),
});

const RpcInner = Schema.Struct({
  index: Schema.Number,
  instructions: Schema.Array(Schema.Struct({
    programIdIndex: Schema.Number,
    accounts: Schema.Array(Schema.Number),
    data: Schema.String,
    stackHeight: OptionalNumber,
  })),
});

export const RpcTransaction = Schema.NullOr(Schema.Struct({
  slot: Schema.Number,
  blockTime: OptionalNumber,
  transaction: Schema.Array(Schema.String),
  meta: Schema.NullOr(Schema.Struct({
    err: Schema.Unknown,
    fee: Schema.Number,
    preBalances: Schema.Array(Schema.Number),
    postBalances: Schema.Array(Schema.Number),
    preTokenBalances: Schema.optionalKey(Schema.NullOr(Schema.Array(RpcTokenBalance))),
    postTokenBalances: Schema.optionalKey(Schema.NullOr(Schema.Array(RpcTokenBalance))),
    loadedAddresses: Schema.optionalKey(Schema.NullOr(Schema.Struct({ writable: Schema.Array(Schema.String), readonly: Schema.Array(Schema.String) }))),
    innerInstructions: Schema.optionalKey(Schema.NullOr(Schema.Array(RpcInner))),
  })),
}));

export const RpcSimulationReply = slotted(Schema.Struct({
  err: Schema.Unknown,
  accounts: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.NullOr(RpcAccount)))),
  unitsConsumed: OptionalNumber,
}));

export interface Account {
  readonly owner: Address;
  readonly lamports: bigint;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

export interface Slotted<A> {
  readonly slot: number;
  readonly value: A;
}

export interface LatestBlockhash {
  readonly blockhash: Blockhash;
  readonly lastValidBlockHeight: number;
}

export interface BlockSummary {
  readonly blockhash: Blockhash;
  readonly previousBlockhash: Blockhash;
  readonly parentSlot: number;
  readonly blockHeight: number | undefined;
  readonly blockTime: number | undefined;
}

export interface SignatureEntry {
  readonly signature: Signature;
  readonly slot: number;
  readonly err: boolean;
  readonly blockTime?: number;
}

export interface SignatureStatus {
  readonly slot: number;
  readonly confirmations: number | undefined;
  readonly err: boolean;
  readonly confirmationStatus: "processed" | "confirmed" | "finalized" | undefined;
}

export interface TokenBalance {
  readonly accountIndex: number;
  readonly mint: Address;
  readonly owner: Address | undefined;
  readonly programId: Address | undefined;
  readonly amount: bigint;
  readonly decimals: number;
}

export interface InnerInstructions {
  readonly index: number;
  readonly instructions: ReadonlyArray<CompiledInstruction & { readonly stackHeight: number | undefined }>;
}

export interface TransactionMeta {
  readonly err: boolean;
  readonly fee: bigint;
  readonly preBalances: ReadonlyArray<bigint>;
  readonly postBalances: ReadonlyArray<bigint>;
  readonly preTokenBalances: ReadonlyArray<TokenBalance>;
  readonly postTokenBalances: ReadonlyArray<TokenBalance>;
  readonly loadedWritable: ReadonlyArray<Address>;
  readonly loadedReadonly: ReadonlyArray<Address>;
  readonly innerInstructions: ReadonlyArray<InnerInstructions>;
}

export interface FetchedTransaction {
  readonly slot: number;
  readonly blockTime: number | undefined;
  readonly wire: Uint8Array;
  readonly transaction: DecodedTransaction;
  readonly meta: TransactionMeta;
}

export interface Simulation {
  readonly slot: number;
  readonly err: boolean;
  readonly failure: string | undefined;
  readonly accounts: ReadonlyArray<Account | undefined>;
  readonly unitsConsumed: number | undefined;
}

export type AccountFilter =
  | { readonly kind: "dataSize"; readonly size: number }
  | { readonly kind: "memcmp"; readonly offset: number; readonly bytes: Uint8Array };

export interface SendOptions {
  readonly skipPreflight: boolean;
  readonly maxRetries: number;
}

class Unreadable extends Error {
  readonly issue: string;
  constructor(issue: string) {
    super(issue);
    this.issue = issue;
  }
}

function readable<A>(read: () => A): Decoded<A, string> {
  try {
    return { kind: "decoded", value: read() };
  } catch (error) {
    if (error instanceof Unreadable) return { kind: "malformed", issue: error.issue };
    throw error;
  }
}

function must<A>(value: A | undefined, issue: string): A {
  if (value === undefined) throw new Unreadable(issue);
  return value;
}

function count(value: number, issue: string): number {
  return must(Number.isSafeInteger(value) && value >= 0 ? value : undefined, issue);
}

function lamports(value: number, issue: string): bigint {
  return BigInt(count(value, issue));
}

function u64Text(text: string, issue: string): bigint {
  return must(/^(0|[1-9][0-9]{0,19})$/u.test(text) && BigInt(text) < 1n << 64n ? BigInt(text) : undefined, issue);
}

function present<A>(value: A | null | undefined): A | undefined {
  return value ?? undefined;
}

function account(info: typeof RpcAccount.Type): Account {
  const [encoded, encoding] = info.data;
  if (encoding !== "base64" || encoded === undefined) throw new Unreadable("account data is not base64");
  return {
    owner: must(address(info.owner), "account owner is not an address"),
    lamports: lamports(info.lamports, "account lamports are not an exact integer"),
    data: must(base64Decode(encoded), "account data is not base64"),
    executable: info.executable,
  };
}

function maybeAccount(info: typeof RpcAccount.Type | null): Account | undefined {
  return info === null ? undefined : account(info);
}

/** @throws {never} */
export function accountFromRpc(reply: typeof RpcAccountReply.Type): Decoded<Account | undefined, string> {
  return readable(() => maybeAccount(reply.value));
}

/** @throws {never} */
export function accountsFromRpc(reply: typeof RpcAccountsReply.Type, expected: number): Decoded<Slotted<ReadonlyArray<Account | undefined>>, string> {
  return readable(() => {
    if (reply.value.length !== expected) throw new Unreadable("account count differs from the request");
    return { slot: count(reply.context.slot, "slot is not an exact integer"), value: reply.value.map(maybeAccount) };
  });
}

/** @throws {never} */
export function programAccountsFromRpc(reply: typeof RpcProgramAccounts.Type): Decoded<ReadonlyArray<{ readonly address: Address; readonly account: Account }>, string> {
  return readable(() => reply.map((entry) => ({ address: must(address(entry.pubkey), "program account key is not an address"), account: account(entry.account) })));
}

/** @throws {never} */
export function filterParams(filters: ReadonlyArray<AccountFilter>): ReadonlyArray<unknown> {
  return filters.map((filter) => filter.kind === "dataSize"
    ? { dataSize: filter.size }
    : { memcmp: { offset: filter.offset, bytes: base64Encode(filter.bytes), encoding: "base64" } });
}

/** @throws {never} */
export function blockhashFromRpc(reply: typeof RpcBlockhashReply.Type): Decoded<LatestBlockhash, string> {
  return readable(() => ({
    blockhash: must(isBlockhash(reply.value.blockhash) ? reply.value.blockhash : undefined, "blockhash is not 32 bytes"),
    lastValidBlockHeight: count(reply.value.lastValidBlockHeight, "last valid block height is not an exact integer"),
  }));
}

/** @throws {never} */
export function exactCount(value: number): number | undefined {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** @throws {never} */
export function exactLamports(value: number | null): bigint | undefined {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
}

function hash(text: string, issue: string): Blockhash {
  return must(isBlockhash(text) ? text : undefined, issue);
}

/** @throws {never} */
export function blockFromRpc(reply: typeof RpcBlock.Type): Decoded<BlockSummary | undefined, string> {
  return readable(() => reply === null ? undefined : {
    blockhash: hash(reply.blockhash, "blockhash is not 32 bytes"),
    previousBlockhash: hash(reply.previousBlockhash, "previous blockhash is not 32 bytes"),
    parentSlot: count(reply.parentSlot, "parent slot is not an exact integer"),
    blockHeight: present(reply.blockHeight),
    blockTime: present(reply.blockTime),
  });
}

/** @throws {never} */
export function signaturesFromRpc(reply: typeof RpcSignatureEntries.Type, limit: number): Decoded<ReadonlyArray<SignatureEntry>, string> {
  return readable(() => {
    if (reply.length > limit) throw new Unreadable("page is longer than its limit");
    return reply.map((entry) => {
      const blockTime = present(entry.blockTime);
      return {
        signature: must(isSignature(entry.signature) ? entry.signature : undefined, "signature is not 64 bytes"),
        slot: count(entry.slot, "slot is not an exact integer"),
        err: entry.err !== null && entry.err !== undefined,
        ...(blockTime === undefined ? {} : { blockTime }),
      };
    });
  });
}

/** @throws {never} */
export function statusesFromRpc(reply: typeof RpcStatusesReply.Type, expected: number): Decoded<ReadonlyArray<SignatureStatus | undefined>, string> {
  return readable(() => {
    if (reply.value.length !== expected) throw new Unreadable("status count differs from the request");
    return reply.value.map((status) => status === null ? undefined : {
      slot: count(status.slot, "slot is not an exact integer"),
      confirmations: present(status.confirmations),
      err: status.err !== null && status.err !== undefined,
      confirmationStatus: present(status.confirmationStatus),
    });
  });
}

function tokenBalances(balances: ReadonlyArray<typeof RpcTokenBalance.Type> | null | undefined): ReadonlyArray<TokenBalance> {
  return (balances ?? []).map((balance) => ({
    accountIndex: count(balance.accountIndex, "token balance index is not an exact integer"),
    mint: must(address(balance.mint), "token balance mint is not an address"),
    owner: balance.owner === undefined ? undefined : must(address(balance.owner), "token balance owner is not an address"),
    programId: balance.programId === undefined ? undefined : must(address(balance.programId), "token balance program is not an address"),
    amount: u64Text(balance.uiTokenAmount.amount, "token amount is not an exact u64"),
    decimals: count(balance.uiTokenAmount.decimals, "token decimals are not an exact integer"),
  }));
}

function addresses(list: ReadonlyArray<string>): ReadonlyArray<Address> {
  return list.map((text) => must(address(text), "loaded address is not an address"));
}

/** @throws {never} */
export function transactionFromRpc(reply: typeof RpcTransaction.Type, signature: Signature): Decoded<FetchedTransaction | undefined, string> {
  return readable(() => {
    if (reply === null) return undefined;
    const [encoded, encoding] = reply.transaction;
    if (encoding !== "base64" || encoded === undefined) throw new Unreadable("transaction is not base64");
    const wire = must(base64Decode(encoded), "transaction is not base64");
    const decoded = decodeTransaction(wire);
    if (decoded.kind === "malformed") throw new Unreadable(`transaction wire bytes: ${decoded.issue}`);
    const first = decoded.value.signatures[0];
    if (first === undefined || signatureOf(first) !== signature) throw new Unreadable("transaction's first signature differs from the request");
    const meta = must(present(reply.meta), "transaction metadata is missing");
    const loaded = present(meta.loadedAddresses);
    return {
      slot: count(reply.slot, "slot is not an exact integer"),
      blockTime: present(reply.blockTime),
      wire,
      transaction: decoded.value,
      meta: {
        err: meta.err !== null && meta.err !== undefined,
        fee: lamports(meta.fee, "fee is not an exact integer"),
        preBalances: meta.preBalances.map((value) => lamports(value, "balance is not an exact integer")),
        postBalances: meta.postBalances.map((value) => lamports(value, "balance is not an exact integer")),
        preTokenBalances: tokenBalances(meta.preTokenBalances),
        postTokenBalances: tokenBalances(meta.postTokenBalances),
        loadedWritable: addresses(loaded?.writable ?? []),
        loadedReadonly: addresses(loaded?.readonly ?? []),
        innerInstructions: (meta.innerInstructions ?? []).map((inner) => ({
          index: count(inner.index, "inner instruction index is not an exact integer"),
          instructions: inner.instructions.map((instruction) => ({
            programIndex: count(instruction.programIdIndex, "inner program index is not an exact integer"),
            accounts: instruction.accounts.map((index) => count(index, "inner account index is not an exact integer")),
            data: must(base58Decode(instruction.data), "inner instruction data is not base58"),
            stackHeight: present(instruction.stackHeight),
          })),
        })),
      },
    };
  });
}

/** @throws {never} */
export function simulationFromRpc(reply: typeof RpcSimulationReply.Type, expected: number): Decoded<Simulation, string> {
  return readable(() => {
    const accounts = present(reply.value.accounts) ?? [];
    if (accounts.length !== expected) throw new Unreadable("simulated account count differs from the request");
    const err = reply.value.err !== null && reply.value.err !== undefined;
    return {
      slot: count(reply.context.slot, "slot is not an exact integer"),
      err,
      failure: err ? String(JSON.stringify(reply.value.err)).slice(0, 200) : undefined,
      accounts: accounts.map(maybeAccount),
      unitsConsumed: present(reply.value.unitsConsumed),
    };
  });
}

/** @throws {never} */
export function firstSignature(transaction: Uint8Array): Signature | undefined {
  const decoded = decodeTransaction(transaction);
  const first = decoded.kind === "decoded" ? decoded.value.signatures[0] : undefined;
  return first === undefined ? undefined : signatureOf(first);
}

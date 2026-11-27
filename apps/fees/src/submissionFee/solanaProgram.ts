// spec/fees/submissionFeeDeposits.md, "A deposit pays its pull request only when it meets every term, and only one deposit pays it"; spec/fees/submissionFeeDeposits.md, "Final states and fee income follow the contract's finalized events"
import { type Address, address, associatedTokenAddress, base58Decode, base58Encode, findPda } from "@repo/platform/chain/solana";
import { circleUsdc } from "../runtime/pins.ts";

export const SOLANA_SUBMISSION_FEE_NETWORK = "solana-mainnet";
export const SOLANA_SUBMISSION_FEE_MINT = circleUsdc.solana;
export const SOLANA_SUBMISSION_FEE_KEPT_TO = "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY";
export const SOLANA_SUBMISSION_FEE_PROGRAM_ID: string | null = "4St4KPBhaHZw29gEaqstU9TzYHRfXLq7aat932r1uzW7";
export const SOLANA_SUBMISSION_FEE_START_SLOT: number | null = 474211652;
export const SOLANA_SUBMISSION_FEE_SWITCHED_ON = false;
export const SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES = 169;
export const SOLANA_SUBMISSION_FEE_RENT_LAMPORTS = String((SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES + 128) * 6960);
export const SOLANA_PAY_READS = 6;
export const SOLANA_PAY_LIMITS = { address: 20, item: 30, all: 120 } as const;
export const SOLANA_RECORDS_PER_READ = 100;
export const SOLANA_SIGNATURE_PAGE = 1000;
export const SOLANA_TRANSACTION_BYTES = 1232;

export const CLASSIC_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export const CONFIG_DISCRIMINATOR = new Uint8Array([155, 12, 170, 224, 30, 250, 204, 130]);
export const DEPOSIT_DISCRIMINATOR = new Uint8Array([148, 146, 121, 66, 207, 173, 21, 227]);
const DEPOSIT_IX_DISCRIMINATOR = new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]);
const RECLAIM_IX_DISCRIMINATOR = new Uint8Array([44, 177, 236, 249, 145, 109, 163, 186]);
const RESOLVE_IX_DISCRIMINATOR = new Uint8Array([246, 150, 236, 206, 108, 63, 58, 10]);

export const DEPOSIT_OFFSETS = {
  id: 8,
  payer: 16,
  nonce: 48,
  mint: 56,
  keptTo: 88,
  item: 120,
  amount: 152,
  depositedAt: 160,
  bump: 168,
} as const;

const U64_MAX = (1n << 64n) - 1n;
const HEX32 = /^0x[0-9a-fA-F]{64}$/u;
const WHOLE_U64 = /^(0|[1-9][0-9]{0,19})$/u;
const encoder = new TextEncoder();

export interface SubmissionConfig {
  readonly owner: string;
  readonly pendingOwner: string;
  readonly resolver: string;
  readonly reclaimDelay: number;
  readonly depositCount: bigint;
  readonly depositsPaused: boolean;
  readonly bump: number;
}

export interface SubmissionDeposit {
  readonly id: bigint;
  readonly payer: string;
  readonly nonce: bigint;
  readonly mint: string;
  readonly keptTo: string;
  readonly item: string;
  readonly amount: bigint;
  readonly depositedAt: number;
  readonly bump: number;
}

export interface AccountMeta {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface SolanaInstruction {
  readonly programId: string;
  readonly keys: readonly AccountMeta[];
  readonly data: Uint8Array;
}

export interface SubmissionSettlement {
  readonly kind: "refunded" | "kept" | "reclaimed";
  readonly destination: string;
  readonly mint: string;
  readonly amount: string;
  readonly destinationOwner: string;
  readonly destinationRose: string;
}

export type SettlementParseResult =
  | { readonly ok: true; readonly settlement: SubmissionSettlement | null }
  | { readonly ok: false; readonly issue: string };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function u64Le(value: bigint): Uint8Array | undefined {
  if (value < 0n || value > U64_MAX) return undefined;
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
}

function readI64Le(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigInt64(0, true);
}

function pubkeyBytes(value: string): Uint8Array | undefined {
  const bytes = base58Decode(value);
  return bytes !== undefined && bytes.length === 32 ? bytes : undefined;
}

/** @throws {never} */
export function hex32Bytes(value: string): Uint8Array | undefined {
  if (!HEX32.test(value)) return undefined;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

function bytesToHex32(bytes: Uint8Array): string {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compactU16(value: number): Uint8Array {
  const out: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  out.push(remaining & 0x7f);
  return Uint8Array.from(out);
}

/** @throws {never} */
export function submissionConfigAddress(programId: string): string | undefined {
  const program = address(programId);
  if (program === undefined) return undefined;
  return findPda([encoder.encode("config")], program)?.address;
}

/** @throws {never} */
export function submissionLedgerAddress(programId: string, mint: string): string | undefined {
  const program = address(programId);
  const mintBytes = pubkeyBytes(mint);
  if (program === undefined || mintBytes === undefined) return undefined;
  return findPda([encoder.encode("ledger"), mintBytes], program)?.address;
}

/** @throws {never} */
export function submissionVaultAddress(programId: string, mint: string): string | undefined {
  const program = address(programId);
  const mintBytes = pubkeyBytes(mint);
  if (program === undefined || mintBytes === undefined) return undefined;
  return findPda([encoder.encode("vault"), mintBytes], program)?.address;
}

/** @throws {never} */
export function submissionDepositAddress(programId: string, payer: string, nonce: bigint): string | undefined {
  const program = address(programId);
  const payerBytes = pubkeyBytes(payer);
  const nonceBytes = u64Le(nonce);
  if (program === undefined || payerBytes === undefined || nonceBytes === undefined) return undefined;
  return findPda([encoder.encode("deposit"), payerBytes, nonceBytes], program)?.address;
}

/** @throws {never} */
export function associatedUsdcAccount(wallet: string, mint: string = SOLANA_SUBMISSION_FEE_MINT): string | undefined {
  const owner = address(wallet);
  const tokenMint = address(mint);
  const tokenProgram = address(CLASSIC_TOKEN_PROGRAM);
  if (owner === undefined || tokenMint === undefined || tokenProgram === undefined) return undefined;
  return associatedTokenAddress(owner, tokenMint, tokenProgram);
}

/** @throws {never} */
export function decodeSubmissionConfig(bytes: Uint8Array): SubmissionConfig | undefined {
  if (bytes.length < 122 || !sameBytes(bytes.subarray(0, 8), CONFIG_DISCRIMINATOR)) return undefined;
  const reclaimDelay = readI64Le(bytes, 104);
  if (reclaimDelay < 0n || reclaimDelay > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return {
    owner: base58Encode(bytes.subarray(8, 40)),
    pendingOwner: base58Encode(bytes.subarray(40, 72)),
    resolver: base58Encode(bytes.subarray(72, 104)),
    reclaimDelay: Number(reclaimDelay),
    depositCount: readU64Le(bytes, 112),
    depositsPaused: bytes[120] === 1,
    bump: bytes[121] ?? 0,
  };
}

/** @throws {never} */
export function decodeSubmissionDeposit(bytes: Uint8Array): SubmissionDeposit | undefined {
  if (bytes.length !== SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES || !sameBytes(bytes.subarray(0, 8), DEPOSIT_DISCRIMINATOR)) return undefined;
  const depositedAt = readI64Le(bytes, DEPOSIT_OFFSETS.depositedAt);
  if (depositedAt < 0n || depositedAt > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return {
    id: readU64Le(bytes, DEPOSIT_OFFSETS.id),
    payer: base58Encode(bytes.subarray(DEPOSIT_OFFSETS.payer, DEPOSIT_OFFSETS.payer + 32)),
    nonce: readU64Le(bytes, DEPOSIT_OFFSETS.nonce),
    mint: base58Encode(bytes.subarray(DEPOSIT_OFFSETS.mint, DEPOSIT_OFFSETS.mint + 32)),
    keptTo: base58Encode(bytes.subarray(DEPOSIT_OFFSETS.keptTo, DEPOSIT_OFFSETS.keptTo + 32)),
    item: bytesToHex32(bytes.subarray(DEPOSIT_OFFSETS.item, DEPOSIT_OFFSETS.item + 32)),
    amount: readU64Le(bytes, DEPOSIT_OFFSETS.amount),
    depositedAt: Number(depositedAt),
    bump: bytes[DEPOSIT_OFFSETS.bump] ?? 0,
  };
}

/** @throws {never} */
export function decodeDepositIdSlice(bytes: Uint8Array): number | undefined {
  if (bytes.length !== 8) return undefined;
  const value = readU64Le(bytes, 0);
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}

/** @throws {never} */
export function tokenAccountBalance(bytes: Uint8Array | null, expectedMint: string, expectedOwner: string): bigint | undefined {
  if (bytes === null || bytes.length !== 165) return undefined;
  if (bytes[108] !== 1) return undefined;
  const mint = base58Encode(bytes.subarray(0, 32));
  const owner = base58Encode(bytes.subarray(32, 64));
  if (mint !== expectedMint || owner !== expectedOwner) return undefined;
  return readU64Le(bytes, 64);
}

/** @throws {never} */
export function tokenAccountDeliverable(bytes: Uint8Array | null, expectedMint: string, expectedOwner: string): boolean {
  return tokenAccountBalance(bytes, expectedMint, expectedOwner) !== undefined;
}

/** @throws {never} */
export function depositInstruction(params: {
  readonly programId: string;
  readonly payer: string;
  readonly mint: string;
  readonly source: string;
  readonly item: string;
  readonly amount: bigint;
  readonly keptTo: string;
  readonly nonce: bigint;
}): SolanaInstruction | undefined {
  const config = submissionConfigAddress(params.programId);
  const ledger = submissionLedgerAddress(params.programId, params.mint);
  const vault = submissionVaultAddress(params.programId, params.mint);
  const deposit = submissionDepositAddress(params.programId, params.payer, params.nonce);
  const itemBytes = hex32Bytes(params.item);
  const amountBytes = u64Le(params.amount);
  const keptToBytes = pubkeyBytes(params.keptTo);
  const nonceBytes = u64Le(params.nonce);
  if (config === undefined || ledger === undefined || vault === undefined || deposit === undefined || itemBytes === undefined || amountBytes === undefined || keptToBytes === undefined || nonceBytes === undefined)
    return undefined;
  return {
    programId: params.programId,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: ledger, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.source, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: deposit, isSigner: false, isWritable: true },
      { pubkey: CLASSIC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: concatBytes([DEPOSIT_IX_DISCRIMINATOR, itemBytes, amountBytes, keptToBytes, nonceBytes]),
  };
}

/** @throws {never} */
export function reclaimInstruction(params: {
  readonly programId: string;
  readonly payer: string;
  readonly deposit: string;
  readonly mint: string;
  readonly destination: string;
}): SolanaInstruction | undefined {
  const config = submissionConfigAddress(params.programId);
  const ledger = submissionLedgerAddress(params.programId, params.mint);
  const vault = submissionVaultAddress(params.programId, params.mint);
  if (config === undefined || ledger === undefined || vault === undefined) return undefined;
  return {
    programId: params.programId,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.deposit, isSigner: false, isWritable: true },
      { pubkey: ledger, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: CLASSIC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: RECLAIM_IX_DISCRIMINATOR,
  };
}

/** @throws {never} */
export function resolveInstruction(params: {
  readonly programId: string;
  readonly resolver: string;
  readonly deposit: string;
  readonly mint: string;
  readonly destination: string;
  readonly payer: string;
  readonly refund: boolean;
  readonly expectedId: bigint;
}): SolanaInstruction | undefined {
  const config = submissionConfigAddress(params.programId);
  const ledger = submissionLedgerAddress(params.programId, params.mint);
  const vault = submissionVaultAddress(params.programId, params.mint);
  const idBytes = u64Le(params.expectedId);
  if (config === undefined || ledger === undefined || vault === undefined || idBytes === undefined) return undefined;
  return {
    programId: params.programId,
    keys: [
      { pubkey: params.resolver, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.deposit, isSigner: false, isWritable: true },
      { pubkey: ledger, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: false, isWritable: true },
      { pubkey: CLASSIC_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: concatBytes([RESOLVE_IX_DISCRIMINATOR, new Uint8Array([params.refund ? 1 : 0]), idBytes]),
  };
}

/** @throws {never} */
export function buildSolanaMessage(payer: string, recentBlockhash: string, instructions: readonly SolanaInstruction[]): Uint8Array | undefined {
  const blockhashBytes = pubkeyBytes(recentBlockhash);
  if (blockhashBytes === undefined) return undefined;
  const metaMap = new Map<string, { isSigner: boolean; isWritable: boolean }>();
  metaMap.set(payer, { isSigner: true, isWritable: true });
  for (const ix of instructions) {
    for (const key of ix.keys) {
      const existing = metaMap.get(key.pubkey);
      metaMap.set(key.pubkey, {
        isSigner: (existing?.isSigner ?? false) || key.isSigner,
        isWritable: (existing?.isWritable ?? false) || key.isWritable,
      });
    }
    const existingProgram = metaMap.get(ix.programId);
    if (existingProgram === undefined) metaMap.set(ix.programId, { isSigner: false, isWritable: false });
  }
  const writableSigners: string[] = [payer];
  const readonlySigners: string[] = [];
  const writableNonSigners: string[] = [];
  const readonlyNonSigners: string[] = [];
  for (const [key, meta] of metaMap.entries()) {
    if (key === payer) continue;
    if (meta.isSigner && meta.isWritable) writableSigners.push(key);
    else if (meta.isSigner) readonlySigners.push(key);
    else if (meta.isWritable) writableNonSigners.push(key);
    else readonlyNonSigners.push(key);
  }
  const keys = [...writableSigners, ...readonlySigners, ...writableNonSigners, ...readonlyNonSigners];
  const keyBytesList: Uint8Array[] = [];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] ?? "";
    const decoded = pubkeyBytes(key);
    if (decoded === undefined) return undefined;
    keyBytesList.push(decoded);
    indexByKey.set(key, i);
  }
  const header = new Uint8Array([writableSigners.length + readonlySigners.length, readonlySigners.length, readonlyNonSigners.length]);
  const compiled: Uint8Array[] = [];
  for (const ix of instructions) {
    const programIndex = indexByKey.get(ix.programId);
    if (programIndex === undefined) return undefined;
    const accountIndices = new Uint8Array(ix.keys.length);
    for (let i = 0; i < ix.keys.length; i += 1) {
      const idx = indexByKey.get(ix.keys[i]?.pubkey ?? "");
      if (idx === undefined) return undefined;
      accountIndices[i] = idx;
    }
    compiled.push(concatBytes([new Uint8Array([programIndex]), compactU16(accountIndices.length), accountIndices, compactU16(ix.data.length), ix.data]));
  }
  return concatBytes([header, compactU16(keyBytesList.length), ...keyBytesList, blockhashBytes, compactU16(compiled.length), ...compiled]);
}

/** @throws {never} */
export function buildUnsignedTransaction(message: Uint8Array, signatureCount = 1): Uint8Array {
  return concatBytes([compactU16(signatureCount), new Uint8Array(signatureCount * 64), message]);
}

/** @throws {never} */
export function buildSignedTransaction(signature: Uint8Array, message: Uint8Array): Uint8Array | undefined {
  if (signature.length !== 64) return undefined;
  return concatBytes([new Uint8Array([1]), signature, message]);
}

/** @throws {never} */
export function firstTransactionSignature(wire: Uint8Array): string | undefined {
  if (wire.length <= 65 || wire[0] !== 1) return undefined;
  return base58Encode(wire.subarray(1, 65));
}

/** @throws {never} */
export function isSolanaAddress(value: string): value is Address {
  return address(value) !== undefined;
}

type JsonObject = Readonly<Record<string, unknown>>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asIndex(value: unknown, length: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < length ? value : undefined;
}

interface ParsedInstruction {
  readonly program: string;
  readonly accounts: readonly string[];
  readonly data: Uint8Array;
}

interface ExecutedTx {
  readonly meta: JsonObject;
  readonly keys: readonly string[];
  readonly flat: readonly { readonly ix: JsonObject; readonly height: number; readonly top: number }[];
}

function parseExecutedTx(transaction: unknown): ExecutedTx | null | "invalid" {
  const tx = asObject(transaction);
  if (tx === undefined) return "invalid";
  const meta = asObject(tx.meta);
  if (meta === undefined) return "invalid";
  if (meta.err !== null) return null;
  const innerTx = asObject(tx.transaction);
  const message = innerTx === undefined ? undefined : asObject(innerTx.message);
  if (message === undefined) return "invalid";
  const accountKeys = asArray(message.accountKeys);
  if (accountKeys === undefined) return "invalid";
  const loaded = meta.loadedAddresses === undefined || meta.loadedAddresses === null ? undefined : asObject(meta.loadedAddresses);
  const writable = loaded?.writable === undefined ? [] : asArray(loaded.writable);
  const readonly = loaded?.readonly === undefined ? [] : asArray(loaded.readonly);
  if (writable === undefined || readonly === undefined) return "invalid";
  const keys: string[] = [];
  for (const entry of [...accountKeys, ...writable, ...readonly]) {
    const key = asString(entry);
    if (key === undefined) return "invalid";
    keys.push(key);
  }
  const innerGroups = meta.innerInstructions === undefined || meta.innerInstructions === null ? [] : asArray(meta.innerInstructions);
  if (innerGroups === undefined) return "invalid";
  const inner = new Map<number, readonly unknown[]>();
  for (const groupRaw of innerGroups) {
    const group = asObject(groupRaw);
    const groupIndex = group?.index;
    const groupIxs = group === undefined ? undefined : asArray(group.instructions);
    if (group === undefined || typeof groupIndex !== "number" || !Number.isSafeInteger(groupIndex) || groupIxs === undefined) return "invalid";
    inner.set(groupIndex, groupIxs);
  }
  const topInstructions = asArray(message.instructions);
  if (topInstructions === undefined) return "invalid";
  const flat: { readonly ix: JsonObject; readonly height: number; readonly top: number }[] = [];
  for (let top = 0; top < topInstructions.length; top += 1) {
    const ix = asObject(topInstructions[top]);
    if (ix === undefined) return "invalid";
    flat.push({ ix, height: 1, top });
    for (const childRaw of inner.get(top) ?? []) {
      const child = asObject(childRaw);
      const stackHeight = child?.stackHeight;
      if (child === undefined || typeof stackHeight !== "number" || !Number.isSafeInteger(stackHeight) || stackHeight < 2) return "invalid";
      flat.push({ ix: child, height: stackHeight, top });
    }
  }
  return { meta, keys, flat };
}

function parseInstructionParts(ix: JsonObject, keys: readonly string[]): ParsedInstruction | undefined {
  const programIdx = asIndex(ix.programIdIndex, keys.length);
  const rawAccounts = asArray(ix.accounts);
  const rawData = asString(ix.data);
  if (programIdx === undefined || rawAccounts === undefined || rawData === undefined) return undefined;
  const program = keys[programIdx];
  const data = base58Decode(rawData);
  if (program === undefined || data === undefined) return undefined;
  const accounts: string[] = [];
  for (const entry of rawAccounts) {
    const idx = asIndex(entry, keys.length);
    if (idx === undefined) return undefined;
    const key = keys[idx];
    if (key === undefined) return undefined;
    accounts.push(key);
  }
  return { program, accounts, data };
}

/** @throws {never} */
export function submissionCreation(transaction: unknown, programId: string, deposit: string, record?: SubmissionDeposit): boolean {
  const executed = parseExecutedTx(transaction);
  if (executed === null || executed === "invalid") return false;
  const want = record === undefined
    ? undefined
    : depositInstruction({
      programId,
      payer: record.payer,
      mint: record.mint,
      source: record.payer,
      item: record.item,
      amount: record.amount,
      keptTo: record.keptTo,
      nonce: record.nonce,
    });
  for (const entry of executed.flat) {
    const call = parseInstructionParts(entry.ix, executed.keys);
    if (call === undefined || call.program !== programId || call.data.length < 8) continue;
    if (!sameBytes(call.data.subarray(0, 8), DEPOSIT_IX_DISCRIMINATOR)) continue;
    if (call.accounts[6] !== deposit) continue;
    if (want === undefined) return true;
    if (sameBytes(call.data, want.data) && call.accounts[0] === record?.payer && call.accounts[3] === record?.mint) return true;
  }
  return false;
}

function tokenBalanceUnits(row: JsonObject | undefined): bigint | undefined {
  if (row === undefined) return 0n;
  const ui = asObject(row.uiTokenAmount);
  const text = ui === undefined ? undefined : asString(ui.amount);
  if (text === undefined || !WHOLE_U64.test(text)) return undefined;
  return BigInt(text);
}

function findTokenBalance(entries: unknown, position: number): JsonObject | undefined | "invalid" {
  const rows = entries === undefined || entries === null ? [] : asArray(entries);
  if (rows === undefined) return "invalid";
  const matches: JsonObject[] = [];
  for (const raw of rows) {
    const row = asObject(raw);
    if (row === undefined) return "invalid";
    if (row.accountIndex === position) matches.push(row);
  }
  if (matches.length > 1) return "invalid";
  return matches[0];
}

/** @throws {never} */
export function submissionSettlement(transaction: unknown, programId: string, deposit: string): SettlementParseResult {
  const executed = parseExecutedTx(transaction);
  if (executed === "invalid") return { ok: false, issue: "Invalid Solana transaction record" };
  if (executed === null) return { ok: true, settlement: null };
  const { meta, keys, flat } = executed;
  for (let at = 0; at < flat.length; at += 1) {
    const entry = flat[at];
    if (entry === undefined) continue;
    const call = parseInstructionParts(entry.ix, keys);
    if (call === undefined) return { ok: false, issue: "Malformed Solana instruction" };
    if (call.program !== programId || call.data.length < 8) continue;
    const isResolve = sameBytes(call.data.subarray(0, 8), RESOLVE_IX_DISCRIMINATOR);
    const isReclaim = !isResolve && sameBytes(call.data.subarray(0, 8), RECLAIM_IX_DISCRIMINATOR);
    if (!isResolve && !isReclaim) continue;
    if (call.accounts[2] !== deposit) continue;
    let kind: SubmissionSettlement["kind"] = "reclaimed";
    if (isResolve) {
      if (call.data.length !== 17 || (call.data[8] !== 0 && call.data[8] !== 1))
        return { ok: false, issue: "Malformed resolve instruction" };
      kind = call.data[8] === 1 ? "refunded" : "kept";
    }
    const mint = call.accounts[4];
    const vault = call.accounts[5];
    const destination = call.accounts[6];
    if (mint === undefined || vault === undefined || destination === undefined)
      return { ok: false, issue: "Malformed settlement accounts" };
    if (vault !== submissionVaultAddress(programId, mint))
      return { ok: false, issue: "The settlement names another vault" };
    let amount: bigint | null = null;
    for (let next = at + 1; next < flat.length; next += 1) {
      const candidate = flat[next];
      if (candidate === undefined || candidate.top !== entry.top || candidate.height <= entry.height) break;
      if (candidate.height !== entry.height + 1) continue;
      const child = parseInstructionParts(candidate.ix, keys);
      if (child === undefined) return { ok: false, issue: "Malformed inner instruction" };
      if (child.program === CLASSIC_TOKEN_PROGRAM && child.data.length === 10 && child.data[0] === 12
        && child.accounts[0] === vault && child.accounts[1] === mint && child.accounts[2] === destination) {
        if (amount !== null) return { ok: false, issue: "The settlement moved tokens more than once" };
        amount = readU64Le(child.data, 1);
      }
    }
    if (amount === null || amount <= 0n) return { ok: false, issue: "The settlement shows no token transfer" };
    const position = keys.indexOf(destination);
    const before = findTokenBalance(meta.preTokenBalances, position);
    const after = findTokenBalance(meta.postTokenBalances, position);
    if (before === "invalid" || after === "invalid" || after === undefined)
      return { ok: false, issue: "Invalid transaction token balances" };
    if (asString(after.mint) !== mint) return { ok: false, issue: "The settlement destination holds another token" };
    const beforeUnits = tokenBalanceUnits(before);
    const afterUnits = tokenBalanceUnits(after);
    const owner = asString(after.owner);
    if (beforeUnits === undefined || afterUnits === undefined || owner === undefined)
      return { ok: false, issue: "Invalid transaction token balance values" };
    return {
      ok: true,
      settlement: {
        kind,
        destination,
        mint,
        amount: amount.toString(),
        destinationOwner: owner,
        destinationRose: (afterUnits - beforeUnits).toString(),
      },
    };
  }
  return { ok: true, settlement: null };
}

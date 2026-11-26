// spec/fees/submissionFeeDeposits.md, "A deposit pays its pull request only when it meets every term, and only one deposit pays it"; spec/fees/submissionFeeDeposits.md, "Final states and fee income follow the contract's finalized events"
import { type Address, address, associatedTokenAddress, base58Decode, base58Encode, findPda } from "@repo/platform/chain/solana";
import { circleUsdc } from "../runtime/pins.ts";

export const SOLANA_SUBMISSION_FEE_NETWORK = "solana-mainnet";
export const SOLANA_SUBMISSION_FEE_MINT = circleUsdc.solana;
export const SOLANA_SUBMISSION_FEE_KEPT_TO = "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY";
export const SOLANA_SUBMISSION_FEE_PROGRAM_ID: string | null = null;
export const SOLANA_SUBMISSION_FEE_SWITCHED_ON = false;
export const SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES = 169;
export const SOLANA_SUBMISSION_FEE_RENT_LAMPORTS = String((SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES + 128) * 6960);
export const SOLANA_PAY_READS = 6;
export const SOLANA_PAY_LIMITS = { address: 20, item: 30, all: 120 } as const;

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

function hex32Bytes(value: string): Uint8Array | undefined {
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
  if (bytes.length < SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES || !sameBytes(bytes.subarray(0, 8), DEPOSIT_DISCRIMINATOR)) return undefined;
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
export function tokenAccountBalance(bytes: Uint8Array | null, expectedMint: string, expectedOwner: string): bigint | undefined {
  if (bytes === null || bytes.length < 165) return undefined;
  if (bytes[108] !== 1) return undefined;
  const mint = base58Encode(bytes.subarray(0, 32));
  const owner = base58Encode(bytes.subarray(32, 64));
  if (mint !== expectedMint || owner !== expectedOwner) return undefined;
  return readU64Le(bytes, 64);
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
export function isSolanaAddress(value: string): value is Address {
  return address(value) !== undefined;
}

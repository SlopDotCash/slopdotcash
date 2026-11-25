/**
 * Off-chain view of the `slop-submission-deposits` program (PRD section 6,
 * "Submission fee deposits", "Solana"): its account addresses, the decoding of
 * its `Config` and `Deposit` accounts, the `deposit`, `resolve` and `reclaim`
 * instructions, and the reading of the transaction that settled a deposit.
 * Pure: no RPC, key or clock. The submission-fee Worker, the pay page and the
 * API build to this one file.
 *
 * The committed IDL is the authority for account layouts, instruction
 * arguments, account order and discriminators, so a reviewed change of the
 * program's interface reaches every caller through the IDL and not through
 * numbers copied here.
 *
 * Deposit address (operator decision, 25 November 2026): the record of one
 * deposit is the program address of `["deposit", payer, nonce]`, where the
 * payer picks `nonce` (an unsigned 64-bit number, little-endian) and passes
 * it to `deposit`. The program still numbers deposits 1, 2, 3 in its `Config`
 * and stores that id in the record, with the nonce. An address is not a
 * key: once a deposit is settled its record is closed and the same payer
 * and nonce can make a new deposit at the same address, with a new id.
 */

import { decodeBase58Bytes, encodeBase58Bytes } from "../../src/lib/base58";
import { bytesToHex } from "../../src/lib/byte-encoding";
import {
  solanaAssociatedTokenAddress,
  solanaProgramAddress,
  solanaPublicKeyBytes,
} from "./adapter";
import committedIdl from "./idl/slop_submission_deposits.json" with {
  type: "json",
};
import { CLASSIC_TOKEN_PROGRAM } from "./token";
import type { Instruction } from "./transactions";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const encoder = new TextEncoder();
const U64_MAX = (1n << 64n) - 1n;

type IdlType = string | { array: [string, number] };
interface IdlField {
  name: string;
  type: IdlType;
}
interface IdlAccountMeta {
  name: string;
  writable?: boolean;
  signer?: boolean;
  address?: string;
}
interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlAccountMeta[];
  args: IdlField[];
}
/** The parts of an Anchor IDL this file reads. */
export interface SubmissionDepositsIdl {
  instructions: IdlInstruction[];
  accounts: { name: string; discriminator: number[] }[];
  types: { name: string; type: { kind: string; fields?: IdlField[] } }[];
}

/** The IDL committed beside the program source. */
export const SUBMISSION_DEPOSITS_IDL =
  committedIdl as unknown as SubmissionDepositsIdl;

function sizeOf(type: IdlType): number {
  if (typeof type === "string") {
    const size = { pubkey: 32, u64: 8, i64: 8, bool: 1, u8: 1 }[type];
    if (size === undefined) throw new Error(`Unsupported IDL type ${type}`);
    return size;
  }
  if (type.array[0] !== "u8" || !Number.isSafeInteger(type.array[1]))
    throw new Error("Unsupported IDL array type");
  return type.array[1];
}

interface Layout {
  discriminator: Uint8Array;
  size: number;
  fields: Map<string, { offset: number; type: IdlType }>;
}

function layout(idl: SubmissionDepositsIdl, name: string): Layout {
  const account = idl.accounts.find((entry) => entry.name === name);
  const struct = idl.types.find((entry) => entry.name === name);
  if (
    !account ||
    account.discriminator.length !== 8 ||
    !struct ||
    struct.type.kind !== "struct" ||
    !Array.isArray(struct.type.fields)
  )
    throw new Error(`The IDL has no ${name} account`);
  const fields = new Map<string, { offset: number; type: IdlType }>();
  let offset = 8;
  for (const field of struct.type.fields) {
    fields.set(field.name, { offset, type: field.type });
    offset += sizeOf(field.type);
  }
  return {
    discriminator: Uint8Array.from(account.discriminator),
    size: offset,
    fields,
  };
}

function instruction(idl: SubmissionDepositsIdl, name: string): IdlInstruction {
  const found = idl.instructions.find((entry) => entry.name === name);
  if (!found || found.discriminator.length !== 8)
    throw new Error(`The IDL has no ${name} instruction`);
  return found;
}

function u64(value: bigint, name: string): Uint8Array {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX)
    throw new TypeError(`${name} must be an unsigned 64-bit number`);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function hexBytes(value: string, name: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value))
    throw new TypeError(`${name} must be 32 bytes of 0x hex`);
  return Uint8Array.from(value.slice(2).match(/../gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function encode(type: IdlType, value: unknown, name: string): Uint8Array {
  if (type === "pubkey") return solanaPublicKeyBytes(value as string);
  if (type === "u64") return u64(value as bigint, name);
  if (type === "i64") {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, value as bigint, true);
    return bytes;
  }
  if (type === "bool") {
    if (typeof value !== "boolean")
      throw new TypeError(`${name} must be true or false`);
    return Uint8Array.of(value ? 1 : 0);
  }
  if (typeof type !== "string" && type.array[1] === 32)
    return hexBytes(value as string, name);
  throw new Error(`Unsupported argument type for ${name}`);
}

function build(
  idl: SubmissionDepositsIdl,
  programId: string,
  name: string,
  accounts: Record<string, string>,
  args: Record<string, unknown>,
): Instruction {
  const spec = instruction(idl, name);
  const parts: Uint8Array[] = [Uint8Array.from(spec.discriminator)];
  for (const argument of spec.args) {
    if (!Object.hasOwn(args, argument.name))
      throw new Error(`${name} needs the argument ${argument.name}`);
    parts.push(encode(argument.type, args[argument.name], argument.name));
  }
  const data = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return {
    program: programId,
    accounts: spec.accounts.map((meta) => {
      const key = meta.address ?? accounts[meta.name];
      if (typeof key !== "string")
        throw new Error(`${name} needs the account ${meta.name}`);
      // A fixed address in the IDL is never replaced by a caller's.
      solanaPublicKeyBytes(key);
      return { key, write: meta.writable === true };
    }),
    data,
  };
}

/**
 * Any instruction of the program by its IDL name, for the deployment
 * planner's instructions (`initialize`, `open_vault`) in a local rehearsal.
 * The Worker and the pay page use only the three builders below.
 */
export function submissionInstruction(
  programId: string,
  name: string,
  accounts: Record<string, string>,
  args: Record<string, unknown> = {},
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): Instruction {
  return build(idl, programId, name, accounts, args);
}

/** The program's singleton `Config` (`["config"]`). */
export const submissionConfigAddress = (programId: string) =>
  solanaProgramAddress(programId, [encoder.encode("config")]);
/** A mint's `Ledger` (`["ledger", mint]`), the vault's token authority. */
export const submissionLedgerAddress = (programId: string, mint: string) =>
  solanaProgramAddress(programId, [
    encoder.encode("ledger"),
    solanaPublicKeyBytes(mint),
  ]);
/** A mint's vault token account (`["vault", mint]`). */
export const submissionVaultAddress = (programId: string, mint: string) =>
  solanaProgramAddress(programId, [
    encoder.encode("vault"),
    solanaPublicKeyBytes(mint),
  ]);
/** One deposit's record (`["deposit", payer, nonce]`). */
export const submissionDepositAddress = (
  programId: string,
  payer: string,
  nonce: bigint,
) =>
  solanaProgramAddress(programId, [
    encoder.encode("deposit"),
    solanaPublicKeyBytes(payer),
    u64(nonce, "nonce"),
  ]);

export interface SubmissionConfig {
  owner: string;
  resolver: string;
  /** Seconds a payer waits before reclaiming an unresolved deposit. */
  reclaimDelay: number;
  /** Deposits ever made, and so the latest id. */
  depositCount: number;
  depositsPaused: boolean;
}

export interface SubmissionDeposit {
  id: number;
  /** The wallet that paid, not a token account. */
  payer: string;
  mint: string;
  /** The wallet whose associated token account receives a kept deposit. */
  keptTo: string;
  /** Lowercase 0x hex of the 32 bytes, as on the EVM chains. */
  item: string;
  /** Base units, decimal. */
  amount: string;
  /** The cluster clock when the deposit was made, in seconds. */
  depositedAt: number;
  /** The payer-chosen number in the record's address. */
  nonce: bigint;
}

function reader(bytes: Uint8Array, shape: Layout) {
  if (
    bytes.length !== shape.size ||
    shape.discriminator.some((byte, index) => bytes[index] !== byte)
  )
    throw new Error("Account layout mismatch");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const field = (name: string, type: string) => {
    const found = shape.fields.get(name);
    if (
      !found ||
      (typeof found.type === "string"
        ? found.type !== type
        : type !== "bytes32" || found.type.array[1] !== 32)
    )
      throw new Error(`The IDL has no ${type} field ${name}`);
    return found.offset;
  };
  const safe = (value: bigint, name: string) => {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error(`${name} is out of range`);
    return Number(value);
  };
  return {
    pubkey: (name: string) =>
      encodeBase58Bytes(
        bytes.slice(field(name, "pubkey"), field(name, "pubkey") + 32),
      ),
    u64: (name: string) => view.getBigUint64(field(name, "u64"), true),
    safeU64: (name: string) =>
      safe(view.getBigUint64(field(name, "u64"), true), name),
    safeI64: (name: string) =>
      safe(view.getBigInt64(field(name, "i64"), true), name),
    bool: (name: string) => {
      const byte = bytes[field(name, "bool")];
      if (byte !== 0 && byte !== 1) throw new Error(`${name} is not a boolean`);
      return byte === 1;
    },
    bytes32: (name: string) =>
      `0x${bytesToHex(bytes.slice(field(name, "bytes32"), field(name, "bytes32") + 32))}`,
  };
}

/** The size in bytes of every `Deposit` account, for an account filter. */
export function submissionDepositSize(
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): number {
  return layout(idl, "Deposit").size;
}

/** The first eight bytes of every `Deposit` account, for an account filter. */
export function submissionDepositDiscriminator(
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): Uint8Array {
  return layout(idl, "Deposit").discriminator;
}

/**
 * Where a field of every `Deposit` account starts, for an account filter
 * that compares bytes at a fixed place (`id`, `payer`, `mint`, `kept_to`,
 * `item`).
 */
export function submissionDepositOffset(
  field: string,
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): number {
  const found = layout(idl, "Deposit").fields.get(field);
  if (!found) throw new Error(`The IDL's Deposit has no ${field}`);
  return found.offset;
}

export function decodeSubmissionConfig(
  bytes: Uint8Array,
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): SubmissionConfig {
  const read = reader(bytes, layout(idl, "Config"));
  return {
    owner: read.pubkey("owner"),
    resolver: read.pubkey("resolver"),
    reclaimDelay: read.safeI64("reclaim_delay"),
    depositCount: read.safeU64("deposit_count"),
    depositsPaused: read.bool("deposits_paused"),
  };
}

export function decodeSubmissionDeposit(
  bytes: Uint8Array,
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): SubmissionDeposit {
  const read = reader(bytes, layout(idl, "Deposit"));
  const id = read.safeU64("id");
  const amount = read.u64("amount");
  if (id < 1 || amount <= 0n) throw new Error("Unexpected deposit record");
  return {
    id,
    payer: read.pubkey("payer"),
    mint: read.pubkey("mint"),
    keptTo: read.pubkey("kept_to"),
    item: read.bytes32("item"),
    amount: amount.toString(),
    depositedAt: read.safeI64("deposited_at"),
    nonce: read.u64("nonce"),
  };
}

/**
 * The payer's `deposit`: exactly `amount` of `mint` from `source` (a token
 * account the payer owns, normally the associated one) into the vault, with
 * the record at `["deposit", payer, nonce]`.
 */
export function depositInstruction(
  input: {
    programId: string;
    payer: string;
    mint: string;
    source: string;
    item: string;
    amount: bigint;
    keptTo: string;
    nonce: bigint;
  },
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): Instruction {
  if (input.amount <= 0n) throw new TypeError("amount must be above zero");
  return build(
    idl,
    input.programId,
    "deposit",
    {
      payer: input.payer,
      config: submissionConfigAddress(input.programId),
      ledger: submissionLedgerAddress(input.programId, input.mint),
      mint: input.mint,
      source: input.source,
      vault: submissionVaultAddress(input.programId, input.mint),
      deposit: submissionDepositAddress(
        input.programId,
        input.payer,
        input.nonce,
      ),
      token_program: CLASSIC_TOKEN_PROGRAM,
      system_program: SYSTEM_PROGRAM,
    },
    {
      item: input.item,
      amount: input.amount,
      kept_to: input.keptTo,
      nonce: input.nonce,
    },
  );
}

/**
 * The resolver's `resolve` of one open deposit. The destination is never a
 * caller's choice: the payer's associated token account for a refund, the
 * kept wallet's for a kept deposit, as the program itself requires.
 *
 * `record` is the deposit's record as just read from `deposit`, with its
 * id. A record address can hold a later deposit of the same payer and nonce,
 * so the instruction names the id it means (`expected_id`, where the program
 * takes it) and the program refuses any other.
 */
export function resolveInstruction(
  input: {
    programId: string;
    resolver: string;
    deposit: string;
    record: Pick<SubmissionDeposit, "id" | "payer" | "mint" | "keptTo">;
    refund: boolean;
  },
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): Instruction {
  const { record } = input;
  return build(
    idl,
    input.programId,
    "resolve",
    {
      resolver: input.resolver,
      config: submissionConfigAddress(input.programId),
      deposit: input.deposit,
      ledger: submissionLedgerAddress(input.programId, record.mint),
      mint: record.mint,
      vault: submissionVaultAddress(input.programId, record.mint),
      destination: solanaAssociatedTokenAddress(
        record.mint,
        input.refund ? record.payer : record.keptTo,
      ),
      payer: record.payer,
      token_program: CLASSIC_TOKEN_PROGRAM,
    },
    { refund: input.refund, expected_id: BigInt(record.id) },
  );
}

/** The payer's `reclaim` of their own deposit after the delay. */
export function reclaimInstruction(
  input: {
    programId: string;
    payer: string;
    deposit: string;
    mint: string;
    /** A token account of the mint that the payer owns. */
    destination: string;
  },
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): Instruction {
  return build(
    idl,
    input.programId,
    "reclaim",
    {
      payer: input.payer,
      config: submissionConfigAddress(input.programId),
      deposit: input.deposit,
      ledger: submissionLedgerAddress(input.programId, input.mint),
      mint: input.mint,
      vault: submissionVaultAddress(input.programId, input.mint),
      destination: input.destination,
      token_program: CLASSIC_TOKEN_PROGRAM,
    },
    {},
  );
}

interface Obj {
  [key: string]: unknown;
}
const object = (value: unknown): Obj => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid transaction record");
  return value as Obj;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid transaction record");
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid transaction record");
  return value;
};
const index = (value: unknown, length: number): number => {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) >= length
  )
    throw new Error("Invalid transaction record");
  return Number(value);
};

export interface SubmissionSettlement {
  /** How the deposit's record was closed. */
  kind: "refunded" | "kept" | "reclaimed";
  /** The token account the program paid. */
  destination: string;
  mint: string;
  /** Base units the program's own token transfer moved, decimal. */
  amount: string;
  /** The wallet that owns `destination` after the transaction. */
  destinationOwner: string;
  /** Base units by which `destination` rose in the transaction, decimal. */
  destinationRose: string;
}

/**
 * Every instruction a successful transaction executed, top-level and inner,
 * in execution order, with account indexes resolved to addresses. Null for a
 * failed transaction. `transaction` is `getTransaction` at `json` encoding.
 */
function executedInstructions(transaction: unknown) {
  const tx = object(transaction);
  const meta = object(tx.meta);
  if (meta.err !== null) return null;
  const message = object(object(tx.transaction).message);
  const loaded = meta.loadedAddresses ? object(meta.loadedAddresses) : {};
  const keys = [
    ...list(message.accountKeys),
    ...list(loaded.writable ?? []),
    ...list(loaded.readonly ?? []),
  ].map(text);
  const inner = new Map<number, unknown[]>();
  for (const group of list(meta.innerInstructions ?? []).map(object))
    inner.set(Number(group.index), list(group.instructions));
  const flat: { ix: Obj; height: number; top: number }[] = [];
  list(message.instructions).forEach((value, top) => {
    flat.push({ ix: object(value), height: 1, top });
    for (const child of inner.get(top) ?? []) {
      const ix = object(child);
      if (!Number.isSafeInteger(ix.stackHeight) || Number(ix.stackHeight) < 2)
        throw new Error("Missing inner instruction stack height");
      flat.push({ ix, height: Number(ix.stackHeight), top });
    }
  });
  const parts = (ix: Obj) => ({
    program: keys[index(ix.programIdIndex, keys.length)],
    accounts: list(ix.accounts).map((entry) => keys[index(entry, keys.length)]),
    data: decodeBase58Bytes(text(ix.data)),
  });
  return { meta, keys, flat, parts };
}

/**
 * Whether a transaction created this deposit record: it succeeded and ran
 * this program's `deposit` with `deposit` as the record account.
 */
export function submissionCreation(
  transaction: unknown,
  programId: string,
  deposit: string,
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
  /**
   * The record this transaction must have created. With it the instruction's
   * arguments (item, amount, kept wallet, nonce), payer and mint must be the
   * record's own, byte for byte.
   */
  record?: SubmissionDeposit,
): boolean {
  const executed = executedInstructions(transaction);
  if (executed === null) return false;
  const spec = instruction(idl, "deposit");
  const place = (name: string) =>
    spec.accounts.findIndex((meta) => meta.name === name);
  const at = place("deposit");
  const want = record
    ? depositInstruction(
        {
          programId,
          payer: record.payer,
          mint: record.mint,
          // Any token account of the payer can be the source.
          source: record.payer,
          item: record.item,
          amount: BigInt(record.amount),
          keptTo: record.keptTo,
          nonce: record.nonce,
        },
        idl,
      )
    : null;
  return executed.flat.some(({ ix }) => {
    const call = executed.parts(ix);
    return (
      call.program === programId &&
      call.data.length >= 8 &&
      spec.discriminator.every((byte, index) => call.data[index] === byte) &&
      call.accounts[at] === deposit &&
      (want === null ||
        (call.data.length === want.data.length &&
          call.data.every((byte, index) => byte === want.data[index]) &&
          call.accounts[place("payer")] === record?.payer &&
          call.accounts[place("mint")] === record?.mint))
    );
  });
}

/**
 * Reads how one transaction settled a deposit, or null when it did not.
 *
 * `transaction` is `getTransaction` at `json` encoding. The answer comes from
 * the executed instructions and the token balances of the transaction, never
 * from its logs: an instruction to this program named `resolve` or `reclaim`
 * whose deposit account is `deposit`, the Token program's own
 * `TransferChecked` that it invoked (from the mint's vault to the
 * instruction's destination), and the destination's owner and balance change
 * in the transaction's token balances. A failed transaction settles nothing.
 */
export function submissionSettlement(
  transaction: unknown,
  programId: string,
  deposit: string,
  idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL,
): SubmissionSettlement | null {
  const executed = executedInstructions(transaction);
  if (executed === null) return null;
  const { meta, keys, flat, parts } = executed;
  const tagged = (data: Uint8Array, name: string) => {
    const tag = instruction(idl, name).discriminator;
    return data.length >= 8 && tag.every((byte, at) => data[at] === byte);
  };
  const place = (name: string, account: string) => {
    const at = instruction(idl, name).accounts.findIndex(
      (meta) => meta.name === account,
    );
    if (at < 0) throw new Error(`The IDL's ${name} has no ${account} account`);
    return at;
  };
  for (let at = 0; at < flat.length; at += 1) {
    const entry = flat[at];
    const call = parts(entry.ix);
    if (call.program !== programId) continue;
    const name = tagged(call.data, "resolve")
      ? "resolve"
      : tagged(call.data, "reclaim")
        ? "reclaim"
        : null;
    if (name === null || call.accounts[place(name, "deposit")] !== deposit)
      continue;
    let kind: SubmissionSettlement["kind"] = "reclaimed";
    if (name === "resolve") {
      // `refund` is the first argument; a later one (the expected id) follows.
      const spec = instruction(idl, "resolve");
      const size = spec.args.reduce((n, arg) => n + sizeOf(arg.type), 8);
      if (
        spec.args[0]?.name !== "refund" ||
        call.data.length !== size ||
        call.data[8] > 1
      )
        throw new Error("Malformed resolve instruction");
      kind = call.data[8] === 1 ? "refunded" : "kept";
    }
    const destination = call.accounts[place(name, "destination")];
    const mint = call.accounts[place(name, "mint")];
    const vault = call.accounts[place(name, "vault")];
    if (vault !== submissionVaultAddress(programId, mint))
      throw new Error("The settlement names another vault");
    // The Token program's transfer this instruction itself invoked.
    let amount: bigint | null = null;
    for (let next = at + 1; next < flat.length; next += 1) {
      const candidate = flat[next];
      if (candidate.top !== entry.top || candidate.height <= entry.height)
        break;
      if (candidate.height !== entry.height + 1) continue;
      const child = parts(candidate.ix);
      // TransferChecked: tag 12, amount, decimals; source, mint, destination, authority.
      if (
        child.program === CLASSIC_TOKEN_PROGRAM &&
        child.data.length === 10 &&
        child.data[0] === 12 &&
        child.accounts[0] === vault &&
        child.accounts[1] === mint &&
        child.accounts[2] === destination
      ) {
        if (amount !== null)
          throw new Error("The settlement moved tokens more than once");
        amount = new DataView(
          child.data.buffer,
          child.data.byteOffset,
          child.data.byteLength,
        ).getBigUint64(1, true);
      }
    }
    if (amount === null || amount <= 0n)
      throw new Error("The settlement shows no token transfer");
    const position = keys.indexOf(destination);
    const balance = (entries: unknown) => {
      const found = list(entries ?? [])
        .map(object)
        .filter((row) => row.accountIndex === position);
      if (found.length > 1) throw new Error("Invalid transaction record");
      return found[0] ?? null;
    };
    const before = balance(meta.preTokenBalances);
    const after = balance(meta.postTokenBalances);
    const units = (row: Obj | null) => {
      if (row === null) return 0n;
      const value = text(object(row.uiTokenAmount).amount);
      if (!/^(0|[1-9][0-9]{0,19})$/u.test(value))
        throw new Error("Invalid transaction record");
      return BigInt(value);
    };
    if (after === null || text(after.mint) !== mint)
      throw new Error("The settlement's destination holds another token");
    return {
      kind,
      destination,
      mint,
      amount: amount.toString(),
      destinationOwner: text(after.owner),
      destinationRose: (units(after) - units(before)).toString(),
    };
  }
  return null;
}

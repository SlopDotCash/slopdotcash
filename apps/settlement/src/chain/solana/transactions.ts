// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/solanaScan.md, "A fresh scan invocation verifies the selected endpoint's network"
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  type Address,
  type AddressTableLookup,
  type Blockhash,
  type CompiledInstruction,
  type Message,
  type Signature,
  MAX_TRANSACTION_BYTES,
  decodeTransaction,
  encodeMessage,
  encodeTransaction,
  publicKey,
  signatureOf,
} from "@repo/platform/chain/solana";
import { sameBytes } from "./bytes.ts";

export interface AccountMeta {
  readonly key: Address;
  readonly signer: boolean;
  readonly writable: boolean;
}

export interface Instruction {
  readonly program: Address;
  readonly accounts: ReadonlyArray<AccountMeta>;
  readonly data: Uint8Array;
}

export interface LookupTable {
  readonly address: Address;
  readonly entries: ReadonlyArray<Address>;
}

export type CompileIssue = "tooManyAccounts" | "notEncodable" | "tooLarge";

export type Compiled = { readonly kind: "compiled"; readonly message: Message; readonly bytes: Uint8Array } | { readonly kind: "refused"; readonly issue: CompileIssue };

export const MAX_LEGACY_ACCOUNTS = 32;
const SIGNATURE_BYTES = 64;

const unsigned = (signature: Uint8Array) => signature.every((byte) => byte === 0);

interface Role {
  signer: boolean;
  writable: boolean;
}

function roles(payer: Address, instructions: ReadonlyArray<Instruction>): Map<Address, Role> {
  const seen = new Map<Address, Role>([[payer, { signer: true, writable: true }]]);
  const mark = (key: Address, signer: boolean, writable: boolean) => {
    const role = seen.get(key);
    seen.set(key, role === undefined ? { signer, writable } : { signer: role.signer || signer, writable: role.writable || writable });
  };
  for (const instruction of instructions) {
    for (const meta of instruction.accounts) mark(meta.key, meta.signer, meta.writable);
    mark(instruction.program, false, false);
  }
  return seen;
}

function ordered(seen: Map<Address, Role>, payer: Address, include: (key: Address) => boolean): Address[] {
  const entries = [...seen].filter(([key]) => key !== payer && include(key));
  const pick = (signer: boolean, writable: boolean) => entries.filter(([, role]) => role.signer === signer && role.writable === writable).map(([key]) => key);
  return [...(include(payer) ? [payer] : []), ...pick(true, true), ...pick(true, false), ...pick(false, true), ...pick(false, false)];
}

function header(keys: ReadonlyArray<Address>, seen: Map<Address, Role>) {
  const role = (key: Address) => seen.get(key) as Role;
  const signers = keys.filter((key) => role(key).signer);
  return {
    requiredSignatures: signers.length,
    readonlySigned: signers.filter((key) => !role(key).writable).length,
    readonlyUnsigned: keys.filter((key) => !role(key).signer && !role(key).writable).length,
  };
}

function compiledInstructions(instructions: ReadonlyArray<Instruction>, index: Map<Address, number>): CompiledInstruction[] {
  return instructions.map((instruction) => ({
    programIndex: index.get(instruction.program) as number,
    accounts: instruction.accounts.map((meta) => index.get(meta.key) as number),
    data: instruction.data,
  }));
}

function finish(message: Message): Compiled {
  const bytes = encodeMessage(message);
  if (bytes === undefined) return { kind: "refused", issue: "notEncodable" };
  if (1 + message.header.requiredSignatures * SIGNATURE_BYTES + bytes.length > MAX_TRANSACTION_BYTES) return { kind: "refused", issue: "tooLarge" };
  return { kind: "compiled", message, bytes };
}

/** @throws {never} */
export function compileLegacy(input: { readonly payer: Address; readonly blockhash: Blockhash; readonly instructions: ReadonlyArray<Instruction> }): Compiled {
  const seen = roles(input.payer, input.instructions);
  const keys = ordered(seen, input.payer, () => true);
  if (keys.length > MAX_LEGACY_ACCOUNTS) return { kind: "refused", issue: "tooManyAccounts" };
  const index = new Map(keys.map((key, at) => [key, at]));
  return finish({
    version: "legacy",
    header: header(keys, seen),
    accountKeys: keys,
    recentBlockhash: input.blockhash,
    instructions: compiledInstructions(input.instructions, index),
  });
}

/** @throws {never} */
export function compileV0(input: { readonly payer: Address; readonly blockhash: Blockhash; readonly instructions: ReadonlyArray<Instruction>; readonly tables: ReadonlyArray<LookupTable> }): Compiled {
  const seen = roles(input.payer, input.instructions);
  const programs = new Set(input.instructions.map((instruction) => instruction.program));
  const tableOf = (key: Address) => input.tables.findIndex((table) => table.entries.includes(key));
  const loadable = (key: Address) => !programs.has(key) && !(seen.get(key) as Role).signer && tableOf(key) >= 0;
  const keys = ordered(seen, input.payer, (key) => !loadable(key));
  const loaded = [...seen.keys()].filter(loadable);
  const lookups: AddressTableLookup[] = [];
  const writableLoaded: Address[] = [];
  const readonlyLoaded: Address[] = [];
  input.tables.forEach((table, at) => {
    const mine = loaded.filter((key) => tableOf(key) === at);
    const writable = mine.filter((key) => (seen.get(key) as Role).writable);
    const readonly = mine.filter((key) => !(seen.get(key) as Role).writable);
    if (mine.length === 0) return;
    writableLoaded.push(...writable);
    readonlyLoaded.push(...readonly);
    lookups.push({ table: table.address, writableIndexes: writable.map((key) => table.entries.indexOf(key)), readonlyIndexes: readonly.map((key) => table.entries.indexOf(key)) });
  });
  const all = [...keys, ...writableLoaded, ...readonlyLoaded];
  if (all.length > 256) return { kind: "refused", issue: "tooManyAccounts" };
  const index = new Map(all.map((key, at) => [key, at]));
  return finish({
    version: 0,
    header: header(keys, seen),
    accountKeys: keys,
    recentBlockhash: input.blockhash,
    instructions: compiledInstructions(input.instructions, index),
    lookups,
  });
}

/** @throws {never} */
export function requiredSigners(message: Message): ReadonlyArray<Address> {
  return message.accountKeys.slice(0, message.header.requiredSignatures);
}

/** @throws {never} */
export function unsignedTransaction(message: Message): Uint8Array | undefined {
  return encodeTransaction({ signatures: requiredSigners(message).map(() => new Uint8Array(SIGNATURE_BYTES)), message });
}

/** @throws {never} */
export function withSignature(wire: Uint8Array, signer: Address, signature: Uint8Array): Uint8Array | undefined {
  const decoded = decodeTransaction(wire);
  if (decoded.kind === "malformed" || signature.length !== SIGNATURE_BYTES) return undefined;
  const slot = requiredSigners(decoded.value.message).indexOf(signer);
  if (slot < 0) return undefined;
  const signatures = decoded.value.signatures.map((existing, at) => (at === slot ? signature : existing));
  return encodeTransaction({ signatures, message: decoded.value.message });
}

/** @throws {never} */
export function missingSigners(wire: Uint8Array): ReadonlyArray<Address> | undefined {
  const decoded = decodeTransaction(wire);
  if (decoded.kind === "malformed") return undefined;
  const signers = requiredSigners(decoded.value.message);
  return signers.filter((_, at) => unsigned(decoded.value.signatures[at] as Uint8Array));
}

/** @throws {never} */
export function signedBy(message: Uint8Array, signature: Uint8Array, signer: Address): boolean {
  const key = publicKey(signer);
  if (key === undefined || signature.length !== SIGNATURE_BYTES) return false;
  try {
    return ed25519.verify(signature, message, key, { zip215: false });
  } catch {
    return false;
  }
}

/** @throws {never} */
export function completesPrepared(prepared: Uint8Array, signed: Uint8Array, signer: Address): boolean {
  const before = decodeTransaction(prepared);
  const after = decodeTransaction(signed);
  if (before.kind === "malformed" || after.kind === "malformed") return false;
  const signers = requiredSigners(before.value.message);
  const message = before.value.messageBytes;
  const slot = signers.indexOf(signer);
  return slot >= 0
    && sameBytes(message, after.value.messageBytes)
    && unsigned(before.value.signatures[slot] as Uint8Array)
    && before.value.signatures.every((signature, at) => at === slot || unsigned(signature) || signedBy(message, signature, signers[at] as Address))
    && after.value.signatures.every((signature, at) => at === slot ? signedBy(message, signature, signer) : sameBytes(signature, before.value.signatures[at] as Uint8Array));
}

/** @throws {never} */
export function transactionId(wire: Uint8Array): Signature | undefined {
  const decoded = decodeTransaction(wire);
  const first = decoded.kind === "decoded" ? decoded.value.signatures[0] : undefined;
  return first === undefined || unsigned(first) ? undefined : signatureOf(first);
}

export interface ResolvedInstruction {
  readonly program: Address;
  readonly accounts: ReadonlyArray<Address>;
  readonly data: Uint8Array;
}

/** @throws {never} */
export function resolvedKeys(message: Message, loaded: { readonly writable: ReadonlyArray<Address>; readonly readonly: ReadonlyArray<Address> }): ReadonlyArray<Address> {
  return message.version === "legacy" ? message.accountKeys : [...message.accountKeys, ...loaded.writable, ...loaded.readonly];
}

/** @throws {never} */
export function resolveInstruction(instruction: CompiledInstruction, keys: ReadonlyArray<Address>): ResolvedInstruction | undefined {
  const program = keys[instruction.programIndex];
  const accounts = instruction.accounts.map((at) => keys[at]);
  if (program === undefined || accounts.some((key) => key === undefined)) return undefined;
  return { program, accounts: accounts as Address[], data: instruction.data };
}

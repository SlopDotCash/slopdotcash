// spec/fees/buyback.md, "An EVM order first approves exactly its amount to the pinned bridge"
import { base58 } from "@scure/base";

const createOrderWithNonce = "828362be28ce4432";
const maximumComputeUnits = 1_400_000n;
const maximumPriorityLamports = 1_000_000n;
const defaultComputeUnits = 200_000n;
const solanaMetadataLimit = 512;

export interface DlnSolanaArgs {
  readonly giveAmount: bigint;
  readonly takeChainId: bigint;
  readonly takeToken: string;
  readonly takeAmount: bigint;
  readonly receiver: string;
  readonly externalCall: boolean;
  readonly patchAuthority: string;
  readonly cancelBeneficiary: string | undefined;
  readonly orderAuthority: string;
  readonly allowedTaker: string | undefined;
  readonly affiliate: number;
  readonly referral: bigint | undefined;
  readonly nonce: bigint;
  readonly metadataLength: number;
}

export type ArgsRead = { readonly kind: "Read"; readonly args: DlnSolanaArgs } | { readonly kind: "Refused"; readonly issue: string };

export interface BudgetInstruction {
  readonly program: string;
  readonly accounts: readonly number[];
  readonly data: Uint8Array;
}

export type BudgetCheck = { readonly kind: "Within" } | { readonly kind: "Refused"; readonly issue: string };

class Unreadable extends Error {
  constructor(readonly issue: string) {
    super(issue);
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Unreadable("DLN order data is truncated");
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  u8(): number {
    return this.take(1)[0] ?? 0;
  }
  uint(size: number): bigint {
    const raw = this.take(size);
    let value = 0n;
    for (let i = size - 1; i >= 0; i--) value = (value << 8n) | BigInt(raw[i] ?? 0);
    return value;
  }
  big(): bigint {
    let value = 0n;
    for (const byte of this.take(32)) value = (value << 8n) | BigInt(byte);
    return value;
  }
  vec(limit: number): Uint8Array {
    const length = Number(this.uint(4));
    if (length > limit) throw new Unreadable("DLN order field is too long");
    return this.take(length);
  }
  option<T>(read: () => T): T | undefined {
    const tag = this.u8();
    if (tag === 0) return undefined;
    if (tag !== 1) throw new Unreadable("DLN order option tag is invalid");
    return read();
  }
  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

function read(data: Uint8Array): DlnSolanaArgs {
  const reader = new Reader(data);
  if (hex(reader.take(8)) !== createOrderWithNonce) throw new Unreadable("DLN call is not create_order_with_nonce");
  const giveAmount = reader.uint(8);
  const takeChainId = reader.big();
  const takeToken = hex(reader.vec(64));
  const takeAmount = reader.big();
  const receiver = hex(reader.vec(64));
  const externalCall = reader.option(() => reader.vec(1)) !== undefined;
  const patchAuthority = base58.encode(reader.take(32));
  const cancelBeneficiary = reader.option(() => base58.encode(reader.take(32)));
  const orderAuthority = hex(reader.vec(64));
  const allowedTaker = reader.option(() => hex(reader.vec(64)));
  const affiliate = reader.u8();
  const referral = reader.option(() => reader.uint(4));
  const nonce = reader.uint(8);
  const metadata = reader.vec(solanaMetadataLimit);
  if (!reader.done()) throw new Unreadable("DLN order data has extra bytes");
  return { giveAmount, takeChainId, takeToken, takeAmount, receiver, externalCall, patchAuthority, cancelBeneficiary, orderAuthority, allowedTaker, affiliate, referral, nonce, metadataLength: metadata.length };
}

/** @throws {never} */
export function orderArgs(data: Uint8Array): ArgsRead {
  try {
    return { kind: "Read", args: read(data) };
  } catch (error) {
    return { kind: "Refused", issue: error instanceof Unreadable ? error.issue : "DLN order data is unreadable" };
  }
}

function budget(instructions: readonly BudgetInstruction[], computeBudget: string): BudgetCheck {
  let units: bigint | undefined;
  let price: bigint | undefined;
  for (const instruction of instructions) {
    if (instruction.program !== computeBudget || instruction.accounts.length !== 0) return { kind: "Refused", issue: `DLN order calls ${instruction.program}` };
    const reader = new Reader(instruction.data);
    const tag = reader.u8();
    if (tag === 2 && units === undefined) units = reader.uint(4);
    else if (tag === 3 && price === undefined) price = reader.uint(8);
    else return { kind: "Refused", issue: "DLN order has an unexpected compute instruction" };
    if (!reader.done()) return { kind: "Refused", issue: "DLN compute instruction has extra bytes" };
  }
  const limit = units ?? defaultComputeUnits;
  if (limit > maximumComputeUnits || ((price ?? 0n) * limit + 999_999n) / 1_000_000n > maximumPriorityLamports)
    return { kind: "Refused", issue: "DLN order bids above the priority-fee limit" };
  return { kind: "Within" };
}

/** @throws {never} */
export function computeBudgetWithin(instructions: readonly BudgetInstruction[], computeBudget: string): BudgetCheck {
  try {
    return budget(instructions, computeBudget);
  } catch (error) {
    return { kind: "Refused", issue: error instanceof Unreadable ? error.issue : "DLN compute instruction is unreadable" };
  }
}

/** @throws {never} */
export function chainSeed(chainId: bigint): Uint8Array {
  const seed = new Uint8Array(32);
  let value = chainId;
  for (let i = 31; i >= 0; i--) {
    seed[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return seed;
}

/** @throws {never} */
export function tokenAmountOf(data: Uint8Array): bigint | undefined {
  if (data.length < 72) return undefined;
  let amount = 0n;
  for (let i = 71; i >= 64; i--) amount = (amount << 8n) | BigInt(data[i] ?? 0);
  return amount;
}

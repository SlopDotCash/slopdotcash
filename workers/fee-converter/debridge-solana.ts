/**
 * deBridge DLN order checks on Solana for the SLOP buyback bridge (PRD
 * section 6). The API only proposes a transaction. Before anything is
 * signed, the whole message must be exactly: optional Compute Budget
 * instructions, then one `create_order_with_nonce` call to the pinned DLN
 * program whose decoded arguments equal the Worker's own decision and whose
 * accounts are the addresses this module derives itself. The order's state
 * and escrow accounts are program addresses of the order id, which the
 * program recomputes from the arguments, so a mismatched id cannot execute.
 * Nothing else may ride along: no other program, lookup table or signer.
 */

import {
  programAddress,
  solanaAssociatedTokenAddress,
  solanaBase58,
} from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { DLN } from "./buyback-config";
import type { ParsedTransaction } from "./solana-transaction";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** Anchor discriminator of `create_order_with_nonce`. */
const CREATE_ORDER_WITH_NONCE = "828362be28ce4432";
const MAX_COMPUTE_UNITS = 1_400_000;
/** Highest priority fee the order may bid: 0.001 SOL in total. */
const MAX_PRIORITY_LAMPORTS = 1_000_000n;
const METADATA_LIMIT = 512;

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
function unhex(value: string): Uint8Array {
  const text = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^([0-9a-fA-F]{2})*$/u.test(text)) throw new Error("Malformed hex");
  return Uint8Array.from(text.match(/../gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

/** The order this Worker decided; every decoded field must equal it. */
export interface SolanaDlnIntent {
  /** The Solana fee wallet: maker, patch authority and refund beneficiary. */
  wallet: string;
  /** The classic SPL mint given, and the exact amount. */
  mint: string;
  giveAmount: bigint;
  /** The arrival asset and receiver on Robinhood Chain, as 20-byte hex. */
  takeToken: string;
  takeChainId: bigint;
  receiver: string;
  /** The order id the proposal claims; bound through the derived accounts. */
  orderId: string;
}

export interface CheckedSolanaDlnOrder {
  takeAmount: bigint;
  nonce: bigint;
  /** The wallet's token account the order debits. */
  makerWallet: string;
  /** The order's token escrow; empty once the order is unlocked or refunded. */
  giveOrderWallet: string;
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length)
      throw new Error("DLN order data is truncated");
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  u8(): number {
    return this.take(1)[0];
  }
  uint(bytes: number): bigint {
    let value = 0n;
    const raw = this.take(bytes);
    for (let i = bytes - 1; i >= 0; i--) value = (value << 8n) | BigInt(raw[i]);
    return value;
  }
  /** A 32-byte big-endian unsigned integer. */
  big(): bigint {
    let value = 0n;
    for (const byte of this.take(32)) value = (value << 8n) | BigInt(byte);
    return value;
  }
  vec(limit: number): Uint8Array {
    const length = Number(this.uint(4));
    if (length > limit) throw new Error("DLN order field is too long");
    return this.take(length);
  }
  option<T>(read: () => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) throw new Error("DLN order option tag is invalid");
    return read();
  }
  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

/** The order's escrow token account: the program address of its order id. */
export function dlnGiveOrderWallet(orderId: string): string {
  return programAddress(DLN.solanaProgram, [
    encoder.encode("GIVE_ORDER_WALLET"),
    unhex(orderId),
  ]);
}

/**
 * Refuses any transaction but the intended single order. `resolved` must be
 * the parse of the same bytes.
 */
export function checkedSolanaDlnOrder(
  parsed: ParsedTransaction,
  intent: SolanaDlnIntent,
): CheckedSolanaDlnOrder {
  if (
    parsed.signatureCount !== 1 ||
    parsed.requiredSignatures !== 1 ||
    parsed.readonlySigned !== 0 ||
    parsed.staticKeys[0] !== intent.wallet
  )
    throw new Error("DLN order must have the fee wallet as its only signer");
  if (parsed.lookups.length !== 0)
    throw new Error("DLN order must not load address lookup tables");
  const order = parsed.instructions.at(-1);
  if (!order || order.program !== DLN.solanaProgram)
    throw new Error("DLN order must end with the pinned DLN program call");
  let units: bigint | null = null;
  let price: bigint | null = null;
  for (const instruction of parsed.instructions.slice(0, -1)) {
    const data = new Reader(instruction.data);
    if (
      instruction.program !== COMPUTE_BUDGET ||
      instruction.accounts.length !== 0
    )
      throw new Error(`DLN order calls ${instruction.program}`);
    const tag = data.u8();
    if (tag === 2 && units === null) units = data.uint(4);
    else if (tag === 3 && price === null) price = data.uint(8);
    else throw new Error("DLN order has an unexpected compute instruction");
    if (!data.done())
      throw new Error("DLN compute instruction has extra bytes");
  }
  // A missing unit limit means the 200,000-unit default for one instruction.
  const limit = units ?? 200_000n;
  if (
    limit > BigInt(MAX_COMPUTE_UNITS) ||
    ((price ?? 0n) * limit + 999_999n) / 1_000_000n > MAX_PRIORITY_LAMPORTS
  )
    throw new Error("DLN order bids above the priority-fee limit");

  const data = new Reader(order.data);
  if (hex(data.take(8)) !== CREATE_ORDER_WITH_NONCE)
    throw new Error("DLN call is not create_order_with_nonce");
  const giveAmount = data.uint(8);
  const takeChainId = data.big();
  const takeToken = hex(data.vec(64));
  const takeAmount = data.big();
  const receiver = hex(data.vec(64));
  const externalCall = data.option(() => data.vec(1));
  const patchAuthority = solanaBase58(data.take(32));
  const cancelBeneficiary = data.option(() => solanaBase58(data.take(32)));
  const orderAuthority = hex(data.vec(64));
  const allowedTaker = data.option(() => hex(data.vec(64)));
  // An affiliate fee would carry a beneficiary and an amount; none is allowed.
  const affiliate = data.u8();
  const referral = data.option(() => data.uint(4));
  const nonce = data.uint(8);
  const metadata = data.vec(METADATA_LIMIT);
  if (!data.done()) throw new Error("DLN order data has extra bytes");

  const address = (value: string) => value.toLowerCase().replace(/^0x/u, "");
  if (
    giveAmount !== intent.giveAmount ||
    takeChainId !== intent.takeChainId ||
    takeToken !== address(intent.takeToken) ||
    receiver !== address(intent.receiver) ||
    orderAuthority !== address(intent.receiver) ||
    patchAuthority !== intent.wallet ||
    cancelBeneficiary !== intent.wallet ||
    externalCall !== null ||
    affiliate !== 0 ||
    (referral !== null && referral !== 0n)
  )
    throw new Error("DLN order differs from the fee-wallet intent");
  if (allowedTaker !== null && !DLN.allowedTakers.includes(`0x${allowedTaker}`))
    throw new Error("DLN order reserves its fill for an unknown taker");
  if (takeAmount <= 0n || nonce <= 0n || metadata.length > METADATA_LIMIT)
    throw new Error("DLN order has no arrival amount or nonce");

  // Every account is derived here; the proposal's own list is only compared.
  const pda = (...seeds: Uint8Array[]) =>
    programAddress(DLN.solanaProgram, seeds);
  const orderId = unhex(intent.orderId);
  if (orderId.length !== 32) throw new Error("DLN order id is malformed");
  const chain = new Uint8Array(32);
  for (let i = 0, value = intent.takeChainId; i < 32; i++, value >>= 8n)
    chain[31 - i] = Number(value & 0xffn);
  const makerWallet = solanaAssociatedTokenAddress(intent.mint, intent.wallet);
  const giveOrderWallet = dlnGiveOrderWallet(intent.orderId);
  const expected = [
    intent.wallet,
    pda(encoder.encode("STATE")),
    intent.mint,
    pda(encoder.encode("GIVE_ORDER_STATE"), orderId),
    pda(encoder.encode("AUTHORIZED_NATIVE_SENDER"), chain),
    makerWallet,
    giveOrderWallet,
    pda(encoder.encode("NONCE"), decodeBase58Bytes(intent.wallet)),
    pda(encoder.encode("FEE_LEDGER_WALLET"), decodeBase58Bytes(intent.mint)),
    SYSTEM_PROGRAM,
    TOKEN_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM,
  ];
  const accounts = order.accounts.map((index) => parsed.staticKeys[index]);
  if (
    accounts.length !== expected.length ||
    accounts.some((account, index) => account !== expected[index])
  )
    throw new Error("DLN order accounts differ from the derived order");
  return { takeAmount, nonce, makerWallet, giveOrderWallet };
}

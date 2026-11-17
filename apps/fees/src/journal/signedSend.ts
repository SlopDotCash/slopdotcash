// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/fees/conversion.md, "Only a finalized receipt of one of the row's own attempts settles it"
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import { type Hex, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type TransactionSerialized } from "viem";
import { parseSolanaWire } from "../kernels/solanaWire.ts";

export const jupiterProgram = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export interface EvmSend {
  readonly nonce: number;
  readonly gas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface ReservedSend {
  readonly txId: string;
  readonly rawTx: string;
  readonly intentHash: string;
  readonly wallet: string;
}

export type SendCheck<T> = { readonly kind: "verified"; readonly send: T } | { readonly kind: "refused"; readonly issue: string };

function refused(issue: string): { readonly kind: "refused"; readonly issue: string } {
  return { kind: "refused", issue };
}

/** @throws {never} */
export function signedFees(raw: string): EvmSend | undefined {
  if (!raw.startsWith("0x")) return undefined;
  try {
    const parsed = parseTransaction(raw as Hex);
    const maxFeePerGas = parsed.maxFeePerGas ?? parsed.gasPrice;
    const maxPriorityFeePerGas = parsed.maxPriorityFeePerGas ?? parsed.gasPrice;
    if (parsed.nonce === undefined || parsed.gas === undefined || maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) return undefined;
    return { nonce: parsed.nonce, gas: parsed.gas, maxFeePerGas, maxPriorityFeePerGas };
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export async function verifiedEvmSend(entry: ReservedSend): Promise<SendCheck<EvmSend>> {
  const fees = signedFees(entry.rawTx);
  if (fees === undefined) return refused("the signed bytes are not a complete EVM transaction");
  if (keccak256(entry.rawTx as Hex) !== entry.txId) return refused("the signed attempt hash differs from its transaction identifier");
  try {
    const { r: _r, s: _s, v: _v, yParity: _y, ...unsigned } = parseTransaction(entry.rawTx as Hex);
    if (keccak256(serializeTransaction(unsigned)) !== entry.intentHash) return refused("the signed bytes differ from the reserved intent");
    const signer = await recoverTransactionAddress({ serializedTransaction: entry.rawTx as TransactionSerialized });
    if (signer.toLowerCase() !== entry.wallet) return refused("the signature is not the reserved fee wallet's");
  } catch {
    return refused("the signature of the signed bytes cannot be recovered");
  }
  return { kind: "verified", send: fees };
}

/** @throws {never} */
export function verifiedSolanaSend(entry: ReservedSend, accountProof: string | null): SendCheck<null> {
  let raw: Uint8Array;
  try {
    raw = base64.decode(entry.rawTx);
  } catch {
    return refused("the signed bytes are not base64");
  }
  const parsed = parseSolanaWire(raw);
  if (parsed.kind === "failure") return refused("the signed bytes are not a Solana transaction");
  const wire = parsed.value;
  const key = (index: number) => base58.encode(raw.slice(wire.staticStart + index * 32, wire.staticStart + (index + 1) * 32));
  const programs = wire.instructions.map((instruction) => key(instruction.program));
  if (!wire.legacy || programs.includes(jupiterProgram) || accountProof !== null) return refused("the send needs its retained Solana account review, which the journal cannot run");
  const message = raw.slice(wire.messageOffset);
  const signature = raw.slice(wire.messageOffset - 64, wire.messageOffset);
  if (wire.signatureCount !== 1 || wire.requiredSignatures !== 1 || key(0) !== entry.wallet) return refused("the send is not signed by the reserved fee wallet alone");
  if (base58.encode(signature) !== entry.txId) return refused("the signature differs from its transaction identifier");
  if (base58.encode(sha256(message)) !== entry.intentHash) return refused("the signed message differs from the reserved intent");
  try {
    if (!ed25519.verify(signature, message, base58.decode(entry.wallet))) return refused("the signature does not verify for the reserved fee wallet");
  } catch {
    return refused("the signature does not verify for the reserved fee wallet");
  }
  return { kind: "verified", send: null };
}

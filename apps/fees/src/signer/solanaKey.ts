// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"; spec/fees/runtime.md, "Signing needs a live mode and owner-verified readiness for the exact wallet"
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

export const feeWalletSolanaMarker = "slop-signer:fee-wallet:solana:v1";

export interface SolanaKey {
  readonly address: string;
  readonly publicHalf: string;
  /** @throws {never} */
  sign(message: Uint8Array): Uint8Array;
}

/** @throws {never} */
export function solanaKey(secret: string): SolanaKey | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255)) return undefined;
  const bytes = Uint8Array.from(parsed as number[]);
  const seed = bytes.slice(0, 32);
  try {
    const address = base58.encode(ed25519.getPublicKey(seed));
    return { address, publicHalf: base58.encode(bytes.slice(32)), sign: (message) => ed25519.sign(message, seed) };
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function controlsWallet(secret: string, wallet: string): boolean {
  const key = solanaKey(secret);
  return key !== undefined && key.address === wallet && key.publicHalf === wallet;
}

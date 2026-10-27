/** Canonical wallet addresses and chain-aware comparisons. */

import { decodeBase58Bytes } from "./base58";
import { chainFamily, type EscrowChain } from "./escrow-policy.mjs";
import { isFundingAddress } from "./funding-address.mjs";

export const WALLET_CLAIM_REPOSITORY = "SlopDotCash/slopdotcash" as const;

/** Networks a contributor may publish a payout wallet for, one claim each. */
export type WalletChain = EscrowChain;
export const WALLET_CHAINS: readonly WalletChain[] = [
  "solana",
  "base",
  "robinhood",
  "ethereum",
];

export function isWalletChain(value: unknown): value is WalletChain {
  return WALLET_CHAINS.includes(value as WalletChain);
}

/** Returns true only for a canonical 32-byte Solana public key. */
export function isSolanaAddress(value: unknown): value is string {
  return isFundingAddress("solana", value);
}
/** Returns the exact decoded bytes used for Solana signature verification. */
export function solanaAddressBytes(value: string): Uint8Array {
  if (!isSolanaAddress(value))
    throw new TypeError("Invalid Solana public address");
  return decodeBase58Bytes(value);
}

/**
 * Returns true only for a canonical lowercase 20-byte EVM account (Base, Robinhood Chain or Ethereum). One
 * spelling per account keeps record digests and duplicate checks exact, and
 * the zero address is refused because a transfer to it burns the funds.
 */
export function isBaseAddress(value: unknown): value is string {
  return isFundingAddress("base", value);
}

/** EVM accounts compare without case; Solana public keys are case-sensitive. */
export function sameWalletAddress(
  family: "evm" | "solana",
  left: string,
  right: string,
): boolean {
  return family === "evm"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Validates an address against the rules of the chain it is claimed on. */
export function isWalletAddress(chain: WalletChain, value: unknown): boolean {
  return (
    isWalletChain(chain) &&
    (chainFamily(chain) === "evm"
      ? isBaseAddress(value)
      : isSolanaAddress(value))
  );
}

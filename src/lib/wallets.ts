/**
 * Parses the public wallet markers allowed in a canonical GitHub claim
 * source, at most one per chain. The marker proves public attribution by the GitHub account, not
 * custody of the key; payout reviewers preserve the exact source observation.
 */

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

export interface PublishedWallet<Chain extends WalletChain = WalletChain> {
  address: string;
  chain: Chain;
}

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

function withoutFencedCode(markdown: string): string[] {
  const retained: string[] = [];
  let fence: "```" | "~~~" | null = null;
  for (const line of markdown.split(/\r?\n/u)) {
    const trimmed = line.trimStart();
    if (!fence && (trimmed.startsWith("```") || trimmed.startsWith("~~~"))) {
      fence = trimmed.slice(0, 3) as "```" | "~~~";
      continue;
    }
    if (fence && trimmed.startsWith(fence)) {
      fence = null;
      continue;
    }
    if (!fence) retained.push(line);
  }
  return retained;
}

/**
 * Finds the exact, standalone markers, at most one per chain. A second marker
 * on the same chain fails closed so an old address cannot remain ambiguously
 * payable after a contributor changes it.
 */
export function parsePublishedWallets(
  markdown: string,
): Partial<{ [Chain in WalletChain]: PublishedWallet<Chain> }> {
  if (typeof markdown !== "string" || markdown.length > 1_000_000) {
    throw new TypeError("GitHub profile README is invalid or too large");
  }
  const pattern =
    /^\s*<!--\s*(?:slop-wallet:v1|gitarmy-wallet:v1)\s+(\{[^\r\n]*\})\s*-->\s*$/u;
  const matches = withoutFencedCode(markdown)
    .map((line) => pattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  const wallets: Partial<Record<WalletChain, PublishedWallet>> = {};
  for (const match of matches) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch (error) {
      throw new TypeError("GitHub profile wallet marker is not valid JSON", {
        cause: error,
      });
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new TypeError(
        "GitHub profile wallet marker must contain an object",
      );
    }
    const marker = parsed as Record<string, unknown>;
    if (Object.keys(marker).sort().join("\0") !== "address\0chain") {
      throw new TypeError("GitHub profile wallet marker has unexpected fields");
    }
    if (!isWalletChain(marker.chain)) {
      throw new TypeError(
        "GitHub profile wallet marker must use Solana, Base, Robinhood Chain or Ethereum",
      );
    }
    if (wallets[marker.chain]) {
      throw new TypeError(
        `GitHub profile README contains multiple ${marker.chain} wallet markers`,
      );
    }
    if (!isWalletAddress(marker.chain, marker.address)) {
      throw new TypeError(
        chainFamily(marker.chain) === "evm"
          ? "GitHub profile wallet marker has an invalid EVM address"
          : "GitHub profile wallet marker has an invalid Solana address",
      );
    }
    wallets[marker.chain] = {
      address: marker.address as string,
      chain: marker.chain,
    };
  }
  return wallets as Partial<{
    [Chain in WalletChain]: PublishedWallet<Chain>;
  }>;
}

/** Returns the Solana marker, the only chain a cycle can settle on today. */
export function parsePublishedWallet(
  markdown: string,
): PublishedWallet<"solana"> | null {
  return parsePublishedWallets(markdown).solana ?? null;
}

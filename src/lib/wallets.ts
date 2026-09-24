/**
 * Parses the public wallet markers allowed in a canonical GitHub claim
 * source, at most one per chain. The marker proves public attribution by the GitHub account, not
 * custody of the key; payout reviewers preserve the exact source observation.
 */

export const WALLET_MARKER_VERSION = "1" as const;
export const WALLET_MARKER_PREFIX = "slop-wallet:v1" as const;
export const WALLET_CLAIM_REPOSITORY = "SlopDotCash/slopdotcash" as const;
export const WALLET_CLAIM_TITLE = "Slop wallet claim" as const;

/** Networks a contributor may publish a payout wallet for, one claim each. */
export const WALLET_CHAINS = ["solana", "base"] as const;
export type WalletChain = (typeof WALLET_CHAINS)[number];

export interface PublishedWallet<Chain extends WalletChain = WalletChain> {
  address: string;
  chain: Chain;
}

export function isWalletChain(value: unknown): value is WalletChain {
  return WALLET_CHAINS.includes(value as WalletChain);
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

function decodeBase58(value: string): Uint8Array | null {
  if (!value || value.length > 44) return null;
  const bytes: number[] = [0];
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return null;
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") {
    leadingZeroes += 1;
  }
  const significantBytes = bytes.length === 1 && bytes[0] === 0 ? [] : bytes;
  const decoded = new Uint8Array(leadingZeroes + significantBytes.length);
  for (let index = 0; index < significantBytes.length; index += 1) {
    decoded[decoded.length - 1 - index] = significantBytes[index];
  }
  return decoded;
}

/** Returns true only for a canonical 32-byte Solana public key. */
export function isSolanaAddress(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 44 ||
    !/^[1-9A-HJ-NP-Za-km-z]+$/u.test(value)
  ) {
    return false;
  }
  const decoded = decodeBase58(value);
  return decoded !== null && decoded.length === 32;
}

/**
 * Returns the exact 32 decoded bytes of a canonical Solana public key. Callers
 * that verify a signature need the key itself, not its textual form.
 */
export function solanaAddressBytes(value: string): Uint8Array {
  const decoded = isSolanaAddress(value) ? decodeBase58(value) : null;
  if (decoded === null || decoded.length !== 32) {
    throw new TypeError("Invalid Solana public address");
  }
  return decoded;
}

/**
 * Returns true only for a canonical lowercase 20-byte Base account. One
 * spelling per account keeps record digests and duplicate checks exact, and
 * the zero address is refused because a transfer to it burns the funds.
 */
export function isBaseAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^0x[0-9a-f]{40}$/u.test(value) &&
    value !== `0x${"0".repeat(40)}`
  );
}

/** Validates an address against the rules of the chain it is claimed on. */
export function isWalletAddress(chain: WalletChain, value: unknown): boolean {
  return (
    isWalletChain(chain) &&
    (chain === "base" ? isBaseAddress(value) : isSolanaAddress(value))
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
        "GitHub profile wallet marker must use Solana or Base",
      );
    }
    if (wallets[marker.chain]) {
      throw new TypeError(
        `GitHub profile README contains multiple ${marker.chain} wallet markers`,
      );
    }
    if (!isWalletAddress(marker.chain, marker.address)) {
      throw new TypeError(
        marker.chain === "base"
          ? "GitHub profile wallet marker has an invalid Base address"
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

/** Produces the exact marker contributors publish in a GitHub claim source. */
export function formatPublishedWallet(
  address: string,
  chain: WalletChain = "solana",
): string {
  if (!isWalletAddress(chain, address)) {
    throw new TypeError(
      chain === "base"
        ? "Cannot format an invalid Base address"
        : "Cannot format an invalid Solana address",
    );
  }
  return `<!-- ${WALLET_MARKER_PREFIX} ${JSON.stringify({ chain, address })} -->`;
}

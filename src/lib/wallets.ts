/**
 * Parses the single public wallet marker allowed in a canonical GitHub claim
 * source. The marker proves public attribution by the GitHub account, not
 * custody of the key; payout reviewers preserve the exact source observation.
 */

export const WALLET_MARKER_VERSION = "1" as const;
export const WALLET_MARKER_PREFIX = "slop-wallet:v1" as const;
export const WALLET_CLAIM_REPOSITORY = "SlopDotCash/slopdotcash" as const;
export const WALLET_CLAIM_TITLE = "Slop wallet claim" as const;

export interface PublishedWallet {
  address: string;
  chain: "solana";
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
 * Finds an exact, standalone marker. Multiple markers fail closed so an old
 * address cannot remain ambiguously payable after a contributor changes it.
 */
export function parsePublishedWallet(markdown: string): PublishedWallet | null {
  if (typeof markdown !== "string" || markdown.length > 1_000_000) {
    throw new TypeError("GitHub profile README is invalid or too large");
  }
  const pattern =
    /^\s*<!--\s*(?:slop-wallet:v1|gitarmy-wallet:v1)\s+(\{[^\r\n]*\})\s*-->\s*$/u;
  const matches = withoutFencedCode(markdown)
    .map((line) => pattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new TypeError(
      "GitHub profile README contains multiple wallet markers",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch (error) {
    throw new TypeError("GitHub profile wallet marker is not valid JSON", {
      cause: error,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("GitHub profile wallet marker must contain an object");
  }
  const marker = parsed as Record<string, unknown>;
  if (Object.keys(marker).sort().join("\0") !== "address\0chain") {
    throw new TypeError("GitHub profile wallet marker has unexpected fields");
  }
  if (marker.chain !== "solana") {
    throw new TypeError("GitHub profile wallet marker must use Solana");
  }
  if (!isSolanaAddress(marker.address)) {
    throw new TypeError(
      "GitHub profile wallet marker has an invalid Solana address",
    );
  }
  return { address: marker.address, chain: "solana" };
}

/** Produces the exact marker contributors publish in a GitHub claim source. */
export function formatPublishedWallet(address: string): string {
  if (!isSolanaAddress(address)) {
    throw new TypeError("Cannot format an invalid Solana address");
  }
  return `<!-- ${WALLET_MARKER_PREFIX} ${JSON.stringify({ chain: "solana", address })} -->`;
}

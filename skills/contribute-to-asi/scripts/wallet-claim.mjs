/**
 * Validates a public Solana address and renders the canonical Slop wallet claim
 * issue without touching GitHub, local credentials, or private key material.
 */

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const CLAIM_REPOSITORY = "elizaOS/slopdotcash";
const CLAIM_TITLE = "Slop wallet claim";
const MARKER_PREFIX = "slop-wallet:v1";

function decodeBase58(value) {
  if (!value || value.length > 44) return null;
  const bytes = [0];
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
  return leadingZeroes + significantBytes.length;
}

function isSolanaAddress(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 44 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/u.test(value) &&
    decodeBase58(value) === 32
  );
}

function usage() {
  return `Usage:
  node wallet-claim.mjs --address <public-solana-address>

Prints a JSON plan and prefilled GitHub issue URL. It performs no network or
GitHub write and never accepts a seed phrase or private key.`;
}

function addressArgument(values) {
  if (values.includes("--help")) return null;
  if (values.length !== 2 || values[0] !== "--address") {
    throw new TypeError("Expected only --address <public-solana-address>");
  }
  const address = values[1]?.trim();
  if (!isSolanaAddress(address)) {
    throw new TypeError("Address is not a canonical 32-byte Solana public key");
  }
  return address;
}

try {
  const address = addressArgument(process.argv.slice(2));
  if (address === null) {
    process.stdout.write(`${usage()}\n`);
  } else {
    const marker = `<!-- ${MARKER_PREFIX} ${JSON.stringify({ chain: "solana", address })} -->`;
    const query = new URLSearchParams({ title: CLAIM_TITLE, body: marker });
    process.stdout.write(
      `${JSON.stringify(
        {
          address,
          body: marker,
          newIssueUrl: `https://github.com/${CLAIM_REPOSITORY}/issues/new?${query}`,
          repository: CLAIM_REPOSITORY,
          title: CLAIM_TITLE,
        },
        null,
        2,
      )}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `[Slop] wallet claim refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}

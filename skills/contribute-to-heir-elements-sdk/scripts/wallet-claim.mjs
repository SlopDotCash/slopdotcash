/**
 * Validates a public Solana address and registers it in Slop's authenticated,
 * append-only D1 wallet registry. Planning is local; only the explicit
 * `register` command performs GitHub OAuth and a network write.
 */

import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { slopIdentityAssertion } from "./run-receipt.mjs";

const API_ORIGIN = "https://api.slop.cash";
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const MAX_RESPONSE_BYTES = 64 * 1024;

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
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  return leadingZeroes + significant;
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
  node wallet-claim.mjs register --address <public-solana-address>

The first command prints a no-write plan. The register command opens Slop's
one-time GitHub authorization flow and appends an immutable D1 claim. Neither
command accepts a seed phrase, private key, wallet connection, or signature.`;
}

function argumentsFor(values) {
  if (values.includes("--help")) return { action: "help", address: null };
  const action = values[0] === "register" ? "register" : "plan";
  const offset = action === "register" ? 1 : 0;
  if (
    values.length !== offset + 2 ||
    values[offset] !== "--address" ||
    !isSolanaAddress(values[offset + 1]?.trim())
  ) {
    throw new TypeError(
      "Expected --address with a canonical 32-byte Solana public key",
    );
  }
  return { action, address: values[offset + 1].trim() };
}

async function responseJson(response, field) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error(`${field} response exceeded its bound`);
  }
  if (!response.body) throw new Error(`${field} response was not JSON`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`${field} response exceeded its bound`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, total),
      ),
    );
  } catch {
    throw new Error(`${field} response was not JSON`);
  }
}

function claim(value, field) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.schemaVersion !== 1 ||
    typeof value.claimId !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(value.claimId) ||
    !isSolanaAddress(value.address) ||
    typeof value.githubActorId !== "string" ||
    !/^\d+$/u.test(value.githubActorId) ||
    typeof value.githubLogin !== "string" ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    typeof value.recordDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.recordDigest) ||
    !(
      value.supersedesClaimId === null ||
      (typeof value.supersedesClaimId === "string" &&
        /^[A-Za-z0-9_-]+$/u.test(value.supersedesClaimId))
    )
  ) {
    throw new Error(`${field} returned an invalid wallet claim`);
  }
  return value;
}

async function authenticate(fetchImpl, assertionProvider) {
  const assertion = await assertionProvider(fetchImpl);
  const response = await fetchImpl(`${API_ORIGIN}/api/v1/auth/session`, {
    method: "POST",
    headers: { "X-Slop-Identity-Assertion": assertion },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Slop wallet authentication returned HTTP ${response.status}`,
    );
  }
  const result = await responseJson(response, "Slop wallet authentication");
  if (
    typeof result !== "object" ||
    result === null ||
    result.tokenType !== "Bearer" ||
    typeof result.token !== "string" ||
    result.token.length < 20 ||
    result.token.length > 4096
  ) {
    throw new Error("Slop wallet authentication returned invalid credentials");
  }
  return result.token;
}

export async function registerWalletClaim(
  address,
  {
    fetch: fetchImpl = globalThis.fetch,
    assertionProvider = slopIdentityAssertion,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Slop wallet registry transport is unavailable");
  }
  if (!isSolanaAddress(address)) {
    throw new TypeError(
      "Wallet address must be a canonical 32-byte Solana public key",
    );
  }
  const token = await authenticate(fetchImpl, assertionProvider);
  const headers = { Authorization: `Bearer ${token}` };
  const currentResponse = await fetchImpl(
    `${API_ORIGIN}/api/v1/wallet-claims/current`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );
  let current = null;
  if (currentResponse.status !== 404) {
    if (!currentResponse.ok) {
      throw new Error(
        `Current wallet claim returned HTTP ${currentResponse.status}`,
      );
    }
    current = claim(
      await responseJson(currentResponse, "Current wallet claim"),
      "Current wallet claim",
    );
  }
  if (current?.address === address) {
    return current;
  }
  const created = await fetchImpl(`${API_ORIGIN}/api/v1/wallet-claims`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      supersedesClaimId: current?.claimId ?? null,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!created.ok) {
    throw new Error(`Wallet registration returned HTTP ${created.status}`);
  }
  return claim(
    await responseJson(created, "Wallet registration"),
    "Wallet registration",
  );
}

export async function main(values = process.argv.slice(2), options = {}) {
  const parsed = argumentsFor(values);
  if (parsed.action === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed.action === "plan") {
    process.stdout.write(
      `${JSON.stringify(
        {
          action: "register-wallet",
          address: parsed.address,
          authority: `${API_ORIGIN}/api/v1/wallet-claims`,
          authentication: "one-time-github-oauth",
          storage: "append-only-d1",
          writes: false,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const registered = await registerWalletClaim(parsed.address, options);
  process.stdout.write(
    `${JSON.stringify(
      {
        address: registered.address,
        claimId: registered.claimId,
        githubLogin: registered.githubLogin,
        observedAt: registered.observedAt,
        recordDigest: registered.recordDigest,
        sourceUrl: `${API_ORIGIN}/api/v1/wallet-claims/${registered.claimId}`,
      },
      null,
      2,
    )}\n`,
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  existsSync(process.argv[1]) &&
  realpathSync(fileURLToPath(import.meta.url)) ===
    realpathSync(process.argv[1]);
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `[Slop] wallet registration refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}

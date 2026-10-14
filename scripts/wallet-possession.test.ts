/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  buildPaymentWalletMessage,
  verifyPaymentWalletSignature,
} from "../backend/payments/possession";
import {
  verifyWalletPossession,
  WALLET_POSSESSION_LIFETIME_MS,
  walletPossessionMessage,
} from "../src/lib/wallet-possession";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base58(bytes: Uint8Array): string {
  let value = BigInt(
    `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
  let text = "";
  while (value > 0n) {
    text = BASE58_ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return "1".repeat(leading) + (text || "");
}

/** Changes only the unused low bits of the final base64 character. */
function nonCanonicalEncoding(signature: string): string {
  const chars = signature.split("");
  const value = BASE64_ALPHABET.indexOf(chars[85] as string);
  chars[85] = BASE64_ALPHABET[value | 1] as string;
  return chars.join("");
}

const secret = new Uint8Array(32).fill(7);
const address = base58(ed25519.getPublicKey(secret));

function sign(message: string): string {
  const bytes = ed25519.sign(new TextEncoder().encode(message), secret);
  return Buffer.from(bytes).toString("base64");
}

const issuedAt = Date.parse("2026-10-14T00:00:00.000Z");
const challenge = {
  kind: "slop-wallet-possession" as const,
  schemaVersion: "1" as const,
  audience: "slop.cash" as const,
  challengeId: "0123456789abcdef0123456789abcdef",
  claimId: "claim-1",
  githubActorId: "12345",
  address,
  issuedAt: new Date(issuedAt).toISOString(),
  expiresAt: new Date(issuedAt + WALLET_POSSESSION_LIFETIME_MS).toISOString(),
};

describe("wallet possession signature encoding", () => {
  it("accepts the canonical padded base64 signature", () => {
    const signature = sign(walletPossessionMessage(challenge));
    expect(
      verifyWalletPossession({
        challenge,
        signature,
        claimId: "claim-1",
        githubActorId: "12345",
        address,
        now: issuedAt + 1_000,
      }).signature,
    ).toBe(signature);
  });

  it("rejects a non-canonical encoding of the same signature bytes", () => {
    const signature = sign(walletPossessionMessage(challenge));
    const mutated = nonCanonicalEncoding(signature);
    // The mutation changes no decoded byte; only the encoding is wrong.
    expect(Buffer.from(mutated, "base64")).toEqual(
      Buffer.from(signature, "base64"),
    );
    expect(() =>
      verifyWalletPossession({
        challenge,
        signature: mutated,
        claimId: "claim-1",
        githubActorId: "12345",
        address,
        now: issuedAt + 1_000,
      }),
    ).toThrow("canonical padded base64");
  });
});

describe("payment wallet signature encoding", () => {
  const message = buildPaymentWalletMessage({
    actorId: "12345",
    chain: "solana",
    address,
    claimId: "claim-1",
    claimDigest: "abc",
    nonce: "nonce-1",
    expiresAt: "2026-10-14T01:00:00.000Z",
  });

  it("accepts the canonical padded base64 signature", () => {
    expect(
      verifyPaymentWalletSignature("solana", address, message, sign(message)),
    ).toBe(true);
  });

  it("rejects a non-canonical encoding of the same signature bytes", () => {
    const signature = sign(message);
    const mutated = nonCanonicalEncoding(signature);
    expect(Buffer.from(mutated, "base64")).toEqual(
      Buffer.from(signature, "base64"),
    );
    expect(
      verifyPaymentWalletSignature("solana", address, message, mutated),
    ).toBe(false);
  });
});

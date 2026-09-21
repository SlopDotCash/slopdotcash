import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  assertWalletPossessionChallenge,
  isSignableSolanaAddress,
  verifyWalletPossession,
  WALLET_POSSESSION_LIFETIME_MS,
  walletPossessionMessage,
  walletPossessionState,
} from "./wallet-possession";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leading = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leading += "1";
  }
  return (
    leading +
    digits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit])
      .join("")
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Disposable synthetic key material. No production key is created here. */
function disposableSigner(seed: number) {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, address: encodeBase58(publicKey) };
}

const ISSUED_AT = "2026-09-19T12:00:00.000Z";
const NOW = Date.parse(ISSUED_AT) + 1_000;

function challengeFor(address: string) {
  return {
    kind: "slop-wallet-possession",
    schemaVersion: "1",
    audience: "slop.cash",
    challengeId: "a".repeat(32),
    claimId: "30d6e6e1-ea28-4131-94dc-7ddd4118cb9d".replace(/-/gu, ""),
    githubActorId: "12345",
    address,
    issuedAt: ISSUED_AT,
    expiresAt: new Date(
      Date.parse(ISSUED_AT) + WALLET_POSSESSION_LIFETIME_MS,
    ).toISOString(),
  };
}

function sign(
  privateKey: Uint8Array,
  challenge: ReturnType<typeof challengeFor>,
) {
  return encodeBase64(
    ed25519.sign(
      new TextEncoder().encode(
        walletPossessionMessage(assertWalletPossessionChallenge(challenge)),
      ),
      privateKey,
    ),
  );
}

function input(
  challenge: ReturnType<typeof challengeFor>,
  signature: string,
  overrides: Partial<Parameters<typeof verifyWalletPossession>[0]> = {},
) {
  return {
    challenge,
    signature,
    claimId: challenge.claimId,
    githubActorId: challenge.githubActorId,
    address: challenge.address,
    now: NOW,
    ...overrides,
  };
}

describe("wallet possession proof", () => {
  it("accepts a signature by the claimed destination key", () => {
    const signer = disposableSigner(7);
    const challenge = challengeFor(signer.address);
    const attestation = verifyWalletPossession(
      input(challenge, sign(signer.privateKey, challenge)),
    );
    expect(attestation.challenge.address).toBe(signer.address);
  });

  it("states what the signature means and denies payment authority", () => {
    const signer = disposableSigner(7);
    const message = walletPossessionMessage(
      assertWalletPossessionChallenge(challengeFor(signer.address)),
    );
    expect(message.split("\n")[0]).toBe(
      "Slop wallet possession only; no payment authorization.",
    );
  });

  it("rejects a signature by a different key for the same challenge", () => {
    const owner = disposableSigner(7);
    const attacker = disposableSigner(9);
    const challenge = challengeFor(owner.address);
    expect(() =>
      verifyWalletPossession(
        input(challenge, sign(attacker.privateKey, challenge)),
      ),
    ).toThrow(/signature is invalid/u);
  });

  it("refuses a challenge replayed onto another claim, actor, or address", () => {
    const signer = disposableSigner(7);
    const other = disposableSigner(9);
    const challenge = challengeFor(signer.address);
    const signature = sign(signer.privateKey, challenge);
    expect(() =>
      verifyWalletPossession(
        input(challenge, signature, { claimId: "b".repeat(32) }),
      ),
    ).toThrow(/bound to another claim/u);
    expect(() =>
      verifyWalletPossession(
        input(challenge, signature, { githubActorId: "999" }),
      ),
    ).toThrow(/bound to another actor/u);
    expect(() =>
      verifyWalletPossession(
        input(challenge, signature, { address: other.address }),
      ),
    ).toThrow(/bound to another address/u);
  });

  it("expires the challenge at the end of its fixed window", () => {
    const signer = disposableSigner(7);
    const challenge = challengeFor(signer.address);
    const signature = sign(signer.privateKey, challenge);
    expect(() =>
      verifyWalletPossession(
        input(challenge, signature, {
          now: Date.parse(challenge.expiresAt),
        }),
      ),
    ).toThrow(/has expired/u);
    expect(() =>
      verifyWalletPossession(
        input(challenge, signature, {
          now: Date.parse(challenge.issuedAt) - 1,
        }),
      ),
    ).toThrow(/issued in the future/u);
  });

  it("refuses a challenge that widens its own replay window", () => {
    const signer = disposableSigner(7);
    const challenge = {
      ...challengeFor(signer.address),
      expiresAt: new Date(
        Date.parse(ISSUED_AT) + WALLET_POSSESSION_LIFETIME_MS + 1_000,
      ).toISOString(),
    };
    expect(() => assertWalletPossessionChallenge(challenge)).toThrow(
      /fixed challenge lifetime/u,
    );
  });

  it("refuses unexpected fields and non-canonical timestamps", () => {
    const signer = disposableSigner(7);
    expect(() =>
      assertWalletPossessionChallenge({
        ...challengeFor(signer.address),
        extra: true,
      }),
    ).toThrow(/unexpected fields/u);
    expect(() =>
      assertWalletPossessionChallenge({
        ...challengeFor(signer.address),
        issuedAt: "2026-09-19T12:00:00Z",
      }),
    ).toThrow(/canonical UTC issuedAt/u);
  });

  it("refuses a signature that is not exactly 64 bytes of padded base64", () => {
    const signer = disposableSigner(7);
    const challenge = challengeFor(signer.address);
    expect(() => verifyWalletPossession(input(challenge, "abc"))).toThrow(
      /canonical padded base64/u,
    );
  });

  it("reads an off-curve destination as unprovable rather than invalid", () => {
    // A canonical 32-byte address that is not a point on the curve, the shape a
    // program derived address or Squads vault takes.
    const offCurve = encodeBase58(new Uint8Array(32).fill(0xff));
    expect(isSignableSolanaAddress(offCurve)).toBe(false);
    expect(walletPossessionState(offCurve, null)).toBe(
      "not-provable-by-signature",
    );
  });

  it("leaves an unproven destination unproven rather than held", () => {
    const signer = disposableSigner(7);
    expect(walletPossessionState(signer.address, null)).toBe("unproven");
    expect(walletPossessionState(signer.address, ISSUED_AT)).toBe("proven");
  });
});

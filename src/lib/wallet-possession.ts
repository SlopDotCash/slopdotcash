/**
 * Verifies that the holder of a claimed Solana destination key signed a
 * server-issued challenge bound to one wallet claim. A valid attestation proves
 * key possession at signing time. It is not payment authority, not approval of
 * an amount, not a claim that the key is still held, and not a transaction.
 * Slop verifies a signature here; it never holds a key, signs, or broadcasts.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { isSolanaAddress, solanaAddressBytes } from "./wallets";

export const WALLET_POSSESSION_KIND = "slop-wallet-possession" as const;
export const WALLET_POSSESSION_SCHEMA_VERSION = "1" as const;
export const WALLET_POSSESSION_AUDIENCE = "slop.cash" as const;

/**
 * A challenge is short-lived so a signature cannot be prepared long before it
 * is presented. The lifetime is fixed by this module rather than chosen by the
 * caller, so a request cannot widen its own replay window.
 */
export const WALLET_POSSESSION_LIFETIME_MS = 15 * 60_000;

/** Ed25519 detached signatures are exactly 64 bytes, padded base64. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/u;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{32}$/u;
const CLAIM_ID_PATTERN = /^[0-9a-zA-Z_-]{1,64}$/u;
const ACTOR_ID_PATTERN = /^\d{1,20}$/u;

export interface WalletPossessionChallenge {
  kind: typeof WALLET_POSSESSION_KIND;
  schemaVersion: typeof WALLET_POSSESSION_SCHEMA_VERSION;
  audience: typeof WALLET_POSSESSION_AUDIENCE;
  challengeId: string;
  claimId: string;
  githubActorId: string;
  address: string;
  issuedAt: string;
  expiresAt: string;
}

export interface WalletPossessionAttestation {
  challenge: WalletPossessionChallenge;
  signature: string;
}

/**
 * How a destination's possession currently reads. `unproven` is the honest
 * pre-existing state and never blocks a payout or extinguishes a position.
 * `not-provable-by-signature` marks an off-curve address, such as a program
 * derived address or a Squads vault, which is a valid destination that simply
 * cannot produce a detached Ed25519 signature.
 */
export type WalletPossessionState =
  | "proven"
  | "unproven"
  | "not-provable-by-signature";

const CANONICAL_KEYS = [
  "address",
  "audience",
  "challengeId",
  "claimId",
  "expiresAt",
  "githubActorId",
  "issuedAt",
  "kind",
  "schemaVersion",
].join(",");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Wallet possession challenge must be an object");
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, field: string): number {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(
      `Wallet possession challenge requires a canonical UTC ${field}`,
    );
  }
  return Date.parse(value);
}

/**
 * Returns true when the address is a point on the Ed25519 curve, so a detached
 * signature by its key is possible at all. Program derived addresses are
 * deliberately off-curve and return false.
 */
export function isSignableSolanaAddress(address: string): boolean {
  if (!isSolanaAddress(address)) return false;
  try {
    ed25519.Point.fromBytes(solanaAddressBytes(address));
    return true;
  } catch {
    return false;
  }
}

export function assertWalletPossessionChallenge(
  value: unknown,
): WalletPossessionChallenge {
  const challenge = object(value);
  if (Object.keys(challenge).sort().join(",") !== CANONICAL_KEYS) {
    throw new TypeError("Wallet possession challenge has unexpected fields");
  }
  if (
    challenge.kind !== WALLET_POSSESSION_KIND ||
    challenge.schemaVersion !== WALLET_POSSESSION_SCHEMA_VERSION ||
    challenge.audience !== WALLET_POSSESSION_AUDIENCE
  ) {
    throw new TypeError(
      "Wallet possession challenge has an unsupported identity",
    );
  }
  if (
    typeof challenge.challengeId !== "string" ||
    !CHALLENGE_ID_PATTERN.test(challenge.challengeId)
  ) {
    throw new TypeError("Wallet possession challenge id is invalid");
  }
  if (
    typeof challenge.claimId !== "string" ||
    !CLAIM_ID_PATTERN.test(challenge.claimId)
  ) {
    throw new TypeError("Wallet possession challenge claim id is invalid");
  }
  if (
    typeof challenge.githubActorId !== "string" ||
    !ACTOR_ID_PATTERN.test(challenge.githubActorId)
  ) {
    throw new TypeError("Wallet possession challenge actor id is invalid");
  }
  if (!isSolanaAddress(challenge.address)) {
    throw new TypeError("Wallet possession challenge address is invalid");
  }
  const issuedAt = timestamp(challenge.issuedAt, "issuedAt");
  const expiresAt = timestamp(challenge.expiresAt, "expiresAt");
  if (expiresAt - issuedAt !== WALLET_POSSESSION_LIFETIME_MS) {
    throw new TypeError(
      "Wallet possession challenge does not use the fixed challenge lifetime",
    );
  }
  const issuedAtText = new Date(issuedAt).toISOString();
  const expiresAtText = new Date(expiresAt).toISOString();
  return {
    kind: WALLET_POSSESSION_KIND,
    schemaVersion: WALLET_POSSESSION_SCHEMA_VERSION,
    audience: WALLET_POSSESSION_AUDIENCE,
    challengeId: challenge.challengeId,
    claimId: challenge.claimId,
    githubActorId: challenge.githubActorId,
    address: challenge.address,
    issuedAt: issuedAtText,
    expiresAt: expiresAtText,
  };
}

/**
 * The exact UTF-8 bytes a contributor signs. The first line is domain
 * separation: it states what the signature means and expressly denies payment
 * authority, so a signature collected here cannot be presented as consent to
 * move money. The remaining line is the canonical challenge, key-sorted, so the
 * signed bytes bind the claim, the actor, the address, and the time window.
 */
export function walletPossessionMessage(
  challenge: WalletPossessionChallenge,
): string {
  const canonical = JSON.stringify({
    address: challenge.address,
    audience: challenge.audience,
    challengeId: challenge.challengeId,
    claimId: challenge.claimId,
    expiresAt: challenge.expiresAt,
    githubActorId: challenge.githubActorId,
    issuedAt: challenge.issuedAt,
    kind: challenge.kind,
    schemaVersion: challenge.schemaVersion,
  });
  return `Slop wallet possession only; no payment authorization.\n${canonical}`;
}

function decodeSignature(signature: unknown): Uint8Array {
  if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
    throw new TypeError(
      "Wallet possession signature must be 64 bytes of canonical padded base64",
    );
  }
  const binary = atob(signature);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.length !== 64) {
    throw new TypeError("Wallet possession signature must be exactly 64 bytes");
  }
  return bytes;
}

export interface VerifyWalletPossessionInput {
  challenge: unknown;
  signature: unknown;
  /** The claim the attestation is being attached to. */
  claimId: string;
  /** The authenticated actor presenting the attestation. */
  githubActorId: string;
  /** The address recorded on that claim. */
  address: string;
  now: number;
}

/**
 * Verifies one attestation against the claim it is presented for. Every bound
 * field is compared against server-held state rather than trusted from the
 * request, so a signature for one claim, actor, or address cannot be replayed
 * onto another.
 */
export function verifyWalletPossession(
  input: VerifyWalletPossessionInput,
): WalletPossessionAttestation {
  const challenge = assertWalletPossessionChallenge(input.challenge);
  if (challenge.claimId !== input.claimId) {
    throw new TypeError(
      "Wallet possession challenge is bound to another claim",
    );
  }
  if (challenge.githubActorId !== input.githubActorId) {
    throw new TypeError(
      "Wallet possession challenge is bound to another actor",
    );
  }
  if (challenge.address !== input.address) {
    throw new TypeError(
      "Wallet possession challenge is bound to another address",
    );
  }
  const issuedAt = Date.parse(challenge.issuedAt);
  if (issuedAt > input.now) {
    throw new TypeError("Wallet possession challenge was issued in the future");
  }
  if (input.now >= Date.parse(challenge.expiresAt)) {
    throw new TypeError("Wallet possession challenge has expired");
  }
  if (!isSignableSolanaAddress(challenge.address)) {
    throw new TypeError(
      "Wallet possession challenge address is not on the Ed25519 curve",
    );
  }
  const signature = decodeSignature(input.signature);
  // Strict verification, matching the signer-access contract. Permissive
  // consensus rules accept identity-point forgeries; possession must not.
  const valid = ed25519.verify(
    signature,
    new TextEncoder().encode(walletPossessionMessage(challenge)),
    solanaAddressBytes(challenge.address),
    { zip215: false },
  );
  if (!valid) {
    throw new TypeError("Wallet possession signature is invalid");
  }
  return { challenge, signature: input.signature as string };
}

/** Derives the published state for a destination and its attestation, if any. */
export function walletPossessionState(
  address: string,
  attestedAt: string | null,
): WalletPossessionState {
  if (attestedAt !== null) return "proven";
  return isSignableSolanaAddress(address)
    ? "unproven"
    : "not-provable-by-signature";
}

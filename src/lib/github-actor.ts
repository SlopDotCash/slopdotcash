import type { GitHubActor } from "./leaderboard-types";
import { githubUserIdFromPack } from "./verified-ids.ts";

/**
 * Returns the numeric GitHub user ID that a GitHub user node ID encodes, or
 * null. Legacy IDs are base64 of `04:User<id>`. Current IDs are `U_` plus
 * base64url of the MessagePack array `[0, id]`. The ID survives renames and
 * deleted accounts, so no GitHub request is needed to join records by actor.
 */
export function githubUserIdFromNodeId(nodeId: string): string | null {
  let bytes: Uint8Array;
  const current = nodeId.startsWith("U_");
  const text = current ? nodeId.slice(2) : nodeId;
  // Each form has one alphabet: standard base64 for legacy IDs, base64url
  // for current IDs. A spelling from the other alphabet never names an actor.
  if (
    !(current ? /^[A-Za-z0-9_-]{4,64}$/u : /^[A-Za-z0-9+/]{4,64}={0,2}$/u).test(
      text,
    )
  )
    return null;
  try {
    const base64 = text.replace(/-/gu, "+").replace(/_/gu, "/");
    bytes = Uint8Array.from(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (c) => c.charCodeAt(0),
    );
  } catch {
    return null;
  }
  // Only the canonical spelling GitHub emits may name an actor: padded
  // standard base64 for legacy IDs, unpadded base64url for current IDs.
  // Re-encoding rejects stripped or added padding and non-zero unused
  // trailing bits, which atob would otherwise discard silently.
  const encoded = btoa(String.fromCharCode(...bytes));
  const canonical = current
    ? encoded.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")
    : encoded;
  if (canonical !== text) return null;
  if (!current) {
    const legacy = /^04:User([1-9]\d{0,15})$/u.exec(
      new TextDecoder().decode(bytes),
    );
    return legacy ? legacy[1] : null;
  }
  // fixarray(2), positive fixint 0, then the ID as a uint32, or as a uint64
  // only when it exceeds the uint32 range. A fixint, uint8, uint16, or
  // oversized uint64 re-encoding of the same ID is a different byte string
  // GitHub never emits, so it must not name the actor.
  const id = githubUserIdFromPack([...bytes]);
  return id > 0n ? id.toString() : null;
}

/**
 * Login and immutable-ID tie order for project and global standings and for
 * the largest-remainder extra unit. English case folding and collation keep
 * that order the same on every host. A default locale that case-folds "I"
 * to "ı" would otherwise move a tied contributor and change the recipient
 * of the leftover base unit.
 */
export function compareActors(
  left: Pick<GitHubActor, "id" | "login">,
  right: Pick<GitHubActor, "id" | "login">,
): number {
  const leftLogin = left.login.toLocaleLowerCase("en");
  const rightLogin = right.login.toLocaleLowerCase("en");
  return (
    leftLogin.localeCompare(rightLogin, "en") ||
    left.login.localeCompare(right.login, "en") ||
    left.id.localeCompare(right.id, "en")
  );
}

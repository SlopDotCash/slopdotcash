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
  // fixarray(2), positive fixint 0, then a positive fixint or uint8..uint64.
  if (bytes[0] !== 0x92 || bytes[1] !== 0x00) return null;
  const tag = bytes[2];
  const uint = [0xcc, 0xcd, 0xce, 0xcf].indexOf(tag);
  const width = tag <= 0x7f ? 0 : uint < 0 ? -1 : 1 << uint;
  if (width < 0 || bytes.length !== 3 + width) return null;
  let id = width === 0 ? BigInt(tag) : 0n;
  for (let i = 0; i < width; i++) id = (id << 8n) | BigInt(bytes[3 + i]);
  return id > 0n ? id.toString() : null;
}

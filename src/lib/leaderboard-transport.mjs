import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const MAX_LEADERBOARD_BYTES = 32 * 1024 * 1024;
export const MAX_LEADERBOARD_PART_BYTES = 8 * 1024 * 1024;
export const MAX_LEADERBOARD_FILE_BYTES = 25 * 1024 * 1024;
const FORMAT = "slop-leaderboard-parts-v1";
const hash = (bytes) => bytesToHex(sha256(bytes));
const exactKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort());

/** Physical transport only: the logical JSON bytes and their digest do not change. */
export function encodeLeaderboardParts(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_LEADERBOARD_BYTES)
    throw new RangeError("Leaderboard exceeds the supported snapshot size");
  if (bytes.length <= MAX_LEADERBOARD_FILE_BYTES)
    return { root: bytes, parts: [] };
  const parts = [];
  for (
    let offset = 0;
    offset < bytes.length;
    offset += MAX_LEADERBOARD_PART_BYTES
  ) {
    const part = bytes.slice(offset, offset + MAX_LEADERBOARD_PART_BYTES);
    parts.push({ path: `/data/leaderboard/${hash(part)}.part`, bytes: part });
  }
  return {
    root: new TextEncoder().encode(
      `${JSON.stringify({
        format: FORMAT,
        bytes: bytes.length,
        sha256: hash(bytes),
        parts: parts.map((part) => ({
          path: part.path,
          bytes: part.bytes.length,
          sha256: hash(part.bytes),
        })),
      })}\n`,
    ),
    parts,
  };
}

/** Accept legacy JSON or verify every ordered part before returning the original bytes. */
export async function readLeaderboardBytes(root, readPart) {
  if (!(root instanceof Uint8Array) || root.length > MAX_LEADERBOARD_BYTES)
    throw new RangeError("Leaderboard exceeds the supported snapshot size");
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(root),
  );
  if (value?.format !== FORMAT) return root;
  if (
    root.length > 64 * 1024 ||
    !exactKeys(value, ["format", "bytes", "sha256", "parts"]) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= MAX_LEADERBOARD_FILE_BYTES ||
    value.bytes > MAX_LEADERBOARD_BYTES ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Array.isArray(value.parts) ||
    value.parts.length !== Math.ceil(value.bytes / MAX_LEADERBOARD_PART_BYTES)
  )
    throw new Error("Invalid leaderboard parts manifest");
  // Check the entire manifest before performing any further read.
  let total = 0;
  for (let i = 0; i < value.parts.length; i++) {
    const part = value.parts[i];
    if (
      !exactKeys(part, ["path", "bytes", "sha256"]) ||
      !/^[a-f0-9]{64}$/.test(part.sha256) ||
      part.path !== `/data/leaderboard/${part.sha256}.part` ||
      part.bytes !== Math.min(MAX_LEADERBOARD_PART_BYTES, value.bytes - total)
    )
      throw new Error("Invalid leaderboard part");
    total += part.bytes;
  }
  if (total !== value.bytes) throw new Error("Incomplete leaderboard parts");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of value.parts) {
    const data = await readPart(part.path);
    if (
      !(data instanceof Uint8Array) ||
      data.length !== part.bytes ||
      hash(data) !== part.sha256
    )
      throw new Error("Leaderboard part size or digest mismatch");
    bytes.set(data, offset);
    offset += data.length;
  }
  if (hash(bytes) !== value.sha256)
    throw new Error("Leaderboard snapshot digest mismatch");
  return bytes;
}

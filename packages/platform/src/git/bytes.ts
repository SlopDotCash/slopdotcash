// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const loose = new TextDecoder("utf-8", { ignoreBOM: true });

/** @throws {never} */
export function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    return strict.decode(bytes);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function lossyText(bytes: Uint8Array): string {
  return loose.decode(bytes);
}

/** @throws {never} */
export function textBytes(text: string): Uint8Array {
  return utf8ToBytes(text);
}

/** @throws {never} */
export function concatBytes(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** @throws {never} */
export function hexOf(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/** @throws {never} */
export function sha256Of(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

/** @throws {never} */
export function gitObjectId(kind: "blob" | "tree", body: Uint8Array): string {
  return bytesToHex(sha1.create().update(utf8ToBytes(`${kind} ${body.length}\0`)).update(body).digest());
}

/** @throws {never} */
export function parsedJson(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

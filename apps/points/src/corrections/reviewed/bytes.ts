import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

export type Compression = "gzip" | "br";

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** @throws {never} */
export function commitObjectId(raw: string): string {
  const bytes = Buffer.from(raw);
  return createHash("sha1").update(`commit ${bytes.length}\0`).update(bytes).digest("hex");
}

/** @throws {never} */
export function base64Bytes(text: string): Uint8Array | null {
  return base64.test(text) ? new Uint8Array(Buffer.from(text, "base64")) : null;
}

/** @throws {never} */
export function concatenated(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

/** @throws {never} */
export function inflated(bytes: Uint8Array, compression: Compression, limit: number): Uint8Array | null {
  try {
    const options = { maxOutputLength: Math.max(1, limit) };
    return new Uint8Array(compression === "br" ? brotliDecompressSync(bytes, options) : gunzipSync(bytes, options));
  } catch {
    return null;
  }
}

/** @throws {never} */
export function base64urlKey(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(text)) return null;
  const key = Buffer.from(text, "base64url");
  return key.length === 32 && key.toString("base64url") === text ? new Uint8Array(key) : null;
}

/** @throws {never} */
export function packetNonce(key: Uint8Array, aad: string, plainDigest: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(`slop-packet-nonce-v1\0${aad}\0${plainDigest}`).digest().subarray(0, 12));
}

/** @throws {never} */
export function sealedFrame(key: Uint8Array, nonce: Uint8Array, aad: string, plain: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  return new Uint8Array(Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]));
}

/** @throws {never} */
export function openedFrame(key: Uint8Array, nonce: Uint8Array, aad: string, frame: Uint8Array): Uint8Array | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(frame.subarray(frame.length - 16));
    return new Uint8Array(Buffer.concat([decipher.update(frame.subarray(12, frame.length - 16)), decipher.final()]));
  } catch {
    return null;
  }
}

/** @throws {never} */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && Buffer.from(left).equals(Buffer.from(right));
}

/** @throws {never} */
export function hexBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

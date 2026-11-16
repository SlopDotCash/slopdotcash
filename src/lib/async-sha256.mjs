import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

/** Native asynchronous SHA-256 for Worker services and artifact generation. */
export async function sha256Hex(input) {
  // Own the view so SharedArrayBuffer-backed inputs also work with WebCrypto.
  const bytes =
    typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** The slice of Bun's native hasher this module can use when it exists. */
interface NativeSha256Hasher {
  update(input: string | Uint8Array): NativeSha256Hasher;
  digest(encoding: "hex"): string;
}

/**
 * Every generator and repository check runs under Bun, whose native
 * SHA-256 produces the identical digest at a fraction of the pure-JS
 * cost; browsers and Workers have no `Bun` global and keep the noble
 * implementation below. Detected once, from the global only, so no
 * runtime-specific import reaches the browser bundle.
 */
const NativeSha256 = (
  globalThis as {
    Bun?: { CryptoHasher?: new (algorithm: "sha256") => NativeSha256Hasher };
  }
).Bun?.CryptoHasher;

/** Browser-safe synchronous SHA-256 shared by public-data validation and generators. */
export function sha256Hex(input: string | Uint8Array): string {
  if (NativeSha256)
    return new NativeSha256("sha256").update(input).digest("hex");
  return bytesToHex(
    sha256(typeof input === "string" ? utf8ToBytes(input) : input),
  );
}

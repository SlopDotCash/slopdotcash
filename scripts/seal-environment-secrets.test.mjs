import { describe, expect, test } from "bun:test";
import { secretbox } from "@noble/ciphers/salsa.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { boxKey, sealNonce, sealSecret } from "./seal-environment-secrets.mjs";

// crypto_box_seal_open, so the test proves the sealed layout round-trips.
function open(recipient, sealedBase64) {
  const sealed = new Uint8Array(Buffer.from(sealedBase64, "base64"));
  const ephemeral = sealed.subarray(0, 32);
  const bytes = secretbox(
    boxKey(recipient.secretKey, ephemeral),
    sealNonce(ephemeral, recipient.publicKey),
  ).open(sealed.subarray(32));
  return new TextDecoder().decode(bytes);
}

describe("seal-environment-secrets", () => {
  const recipient = x25519.keygen();
  const publicKey = Buffer.from(recipient.publicKey).toString("base64");

  test("seals a secret only the recipient key opens", () => {
    const sealed = sealSecret(publicKey, "production-token");
    expect(open(recipient, sealed)).toBe("production-token");
    expect(() => open(x25519.keygen(), sealed)).toThrow();
  });

  test("uses a fresh ephemeral key for every secret", () => {
    expect(sealSecret(publicKey, "same")).not.toBe(
      sealSecret(publicKey, "same"),
    );
  });

  test("refuses an empty secret or a malformed key", () => {
    expect(() => sealSecret(publicKey, "")).toThrow("empty secret");
    expect(() => sealSecret(publicKey, undefined)).toThrow("empty secret");
    expect(() => sealSecret("AAAA", "value")).toThrow("32 bytes");
  });
});

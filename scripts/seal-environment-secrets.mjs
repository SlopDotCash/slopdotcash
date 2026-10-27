// One-time GitHub environment migration: seal named secrets to a GitHub
// environment public key (libsodium crypto_box_seal) so an operator can PUT
// the ciphertext into the new environment. Plaintext never leaves the runner;
// only GitHub's private key can open the output.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hsalsa, secretbox } from "@noble/ciphers/salsa.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
const words = (bytes) =>
  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

// crypto_box_beforenm: HSalsa20 of the X25519 shared secret.
export function boxKey(secretKey, publicKey) {
  const shared = new Uint8Array(x25519.getSharedSecret(secretKey, publicKey));
  const key = new Uint8Array(32);
  hsalsa(SIGMA, words(shared), new Uint32Array(4), words(key));
  return key;
}

export function sealNonce(ephemeralPublicKey, publicKey) {
  const input = new Uint8Array(64);
  input.set(ephemeralPublicKey);
  input.set(publicKey, 32);
  return blake2b(input, { dkLen: 24 });
}

export function sealSecret(
  publicKeyBase64,
  value,
  ephemeral = x25519.keygen(),
) {
  const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, "base64"));
  if (publicKey.length !== 32)
    throw new Error("Environment public key must be 32 bytes");
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Refusing to seal an empty secret");
  const box = secretbox(
    boxKey(ephemeral.secretKey, publicKey),
    sealNonce(ephemeral.publicKey, publicKey),
  ).seal(new TextEncoder().encode(value));
  const sealed = new Uint8Array(32 + box.length);
  sealed.set(ephemeral.publicKey);
  sealed.set(box, 32);
  return Buffer.from(sealed).toString("base64");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [publicKey, keyId, output, ...names] = process.argv.slice(2);
  if (!publicKey || !/^[0-9]+$/.test(keyId ?? "") || !output || !names.length)
    throw new Error("Usage: <public key> <key id> <output> <SECRET_NAME...>");
  const secrets = {};
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name))
      throw new Error(`Invalid secret name ${name}`);
    secrets[name] = sealSecret(publicKey, process.env[name]);
  }
  await writeFile(
    output,
    `${JSON.stringify({ keyId, publicKey, secrets }, null, 2)}\n`,
  );
}

import { bytesHex } from "./worker/subtle.ts";

export interface KeySet {
  readonly ed25519Private: string;
  readonly ed25519Public: string;
  readonly p256Private: string;
  readonly p256Public: string;
  readonly rsaPrivate: string;
  readonly rsaPublic: string;
  readonly aes: string;
}

async function pair(generate: () => Promise<unknown>) {
  const generated = (await generate()) as { readonly privateKey: CryptoKey; readonly publicKey: CryptoKey };
  return {
    privateKey: bytesHex(new Uint8Array(await crypto.subtle.exportKey("pkcs8", generated.privateKey))),
    publicKey: bytesHex(new Uint8Array(await crypto.subtle.exportKey("spki", generated.publicKey))),
  };
}

export async function testKeys(): Promise<KeySet> {
  const ed25519 = await pair(() => crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
  const p256 = await pair(() => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]));
  const rsa = await pair(() => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]));
  return {
    ed25519Private: ed25519.privateKey,
    ed25519Public: ed25519.publicKey,
    p256Private: p256.privateKey,
    p256Public: p256.publicKey,
    rsaPrivate: rsa.privateKey,
    rsaPublic: rsa.publicKey,
    aes: bytesHex(crypto.getRandomValues(new Uint8Array(32))),
  };
}

import { createVerify, generateKeyPairSync } from "node:crypto";

export interface RsaKey {
  readonly pem: string;
  readonly verifies: (data: string, signature: Uint8Array) => boolean;
}

export function generatedRsaKey(): RsaKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    pem: privateKey,
    verifies: (data, signature) => createVerify("RSA-SHA256").update(data).verify(publicKey, signature),
  };
}

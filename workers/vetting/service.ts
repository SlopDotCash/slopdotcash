/** Shared private-service signing. This helper never sends or publishes a request. */

import { vettingSignedMessage } from "../../backend/vetting/handler";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";

export type VettingServiceSigner = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

/** Import only in trusted service/CI memory; callers never log the raw JWK. */
export async function vettingServiceSigner(
  raw: string | undefined,
): Promise<VettingServiceSigner> {
  try {
    const key = JSON.parse(raw ?? "null") as JsonWebKey;
    if (key?.kty !== "OKP" || key.crv !== "Ed25519" || !key.d || !key.x)
      throw new Error();
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: key.kty, crv: key.crv, x: key.x },
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    const challenge = new TextEncoder().encode("slop-vetting-key-pair-check");
    const signature = await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      challenge,
    );
    if (
      !(await crypto.subtle.verify("Ed25519", publicKey, signature, challenge))
    )
      throw new Error();
    return { privateKey, publicKey };
  } catch {
    throw new Error("The scanner signing key is invalid");
  }
}

export async function signedServiceHeaders(input: {
  signer: VettingServiceSigner;
  method: "GET" | "POST" | "PUT";
  pathAndQuery: string;
  body: Uint8Array;
  at?: Date;
}): Promise<Record<string, string>> {
  const path = new URL(input.pathAndQuery, "https://signer.invalid");
  if (
    path.origin !== "https://signer.invalid" ||
    `${path.pathname}${path.search}` !== input.pathAndQuery ||
    !path.pathname.startsWith("/api/v1/vetting/")
  )
    throw new Error("Invalid vetting service path");
  const timestamp = (input.at ?? new Date()).toISOString();
  const rawKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", input.signer.publicKey),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      input.signer.privateKey,
      vettingSignedMessage(
        input.method,
        input.pathAndQuery,
        timestamp,
        await sha256Hex(input.body),
      ) as Uint8Array<ArrayBuffer>,
    ),
  );
  return {
    "x-slop-vetting-key": await sha256Hex(rawKey),
    "x-slop-vetting-timestamp": timestamp,
    "x-slop-vetting-signature": btoa(String.fromCharCode(...signature)),
  };
}

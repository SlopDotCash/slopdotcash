/** Shared private-service signing. This helper never sends or publishes a request. */

import { vettingSignedMessage } from "../../backend/vetting/handler";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";

export type VettingServiceSigner = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};
/** The private vetting service and the key that signs every request to it. */
export type VettingConnection = VettingServiceSigner & {
  origin: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

/**
 * The exact HTTPS service origin. Plain HTTP is accepted only on 127.0.0.1,
 * and only where the local sandbox runner is allowed.
 */
export function serviceOrigin(value: string, allowLoopback = false): string {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        allowLoopback &&
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1"
      ))
  )
    throw new Error("An exact HTTPS service origin is required");
  return value;
}

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

/** One signed request to the service. The caller reads or cancels the body. */
export async function signedVettingFetch(
  connection: VettingConnection,
  request: {
    method: "GET" | "POST" | "PUT";
    path: string;
    body?: Uint8Array;
    contentType?: string;
    timeoutMs: number;
  },
): Promise<Response> {
  const body = request.body ?? new Uint8Array();
  return (connection.fetch ?? fetch)(`${connection.origin}${request.path}`, {
    method: request.method,
    redirect: "error",
    signal: AbortSignal.timeout(request.timeoutMs),
    headers: {
      ...(request.contentType ? { "content-type": request.contentType } : {}),
      ...(await signedServiceHeaders({
        signer: connection,
        method: request.method,
        pathAndQuery: request.path,
        body,
        at: connection.now?.(),
      })),
    },
    ...(request.method === "GET" ? {} : { body: new Uint8Array(body) }),
  });
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

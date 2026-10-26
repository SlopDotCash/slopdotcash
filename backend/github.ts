/** GitHub REST plumbing shared by the backend readers. */
import { encodeBase64Url, ownedBuffer } from "../src/lib/byte-encoding";

export const GITHUB_API = "https://api.github.com";
export const GHSA =
  /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/u;
/** A GitHub login as GitHub issues them today. */
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;

export function githubHeaders(
  token: string | undefined,
  agent: string,
): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": agent,
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** Local browser tests only: a loopback fixture origin replaces the fallback. */
export function loopbackOrigin(
  value: string | undefined,
  fallback: string,
): string {
  return value && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(value)
    ? value
    : fallback;
}

/**
 * The `rel="next"` target of a GitHub Link header, or null without one.
 * A next part without a target throws; callers decide which targets to follow.
 */
export function nextLink(link: string | null): string | null {
  if (link === null) return null;
  const next = link
    .split(",")
    .find((part) => /;\s*rel="next"(?:\s*;|\s*$)/u.test(part));
  if (next === undefined) return null;
  const target = /^\s*<([^<>]+)>/u.exec(next)?.[1];
  if (target === undefined) throw new Error("GitHub returned an invalid link");
  return target;
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** Wraps a PKCS#1 RSA key, which GitHub issues, as PKCS#8 for WebCrypto. */
function pkcs8FromPem(pem: string): Uint8Array {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const body = pem
    .replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/gu, "")
    .replace(/\s+/gu, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!pkcs1) return der;
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const octet = [0x04, ...derLength(der.length)];
  const inner = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  const total = inner.length + der.length;
  return new Uint8Array([0x30, ...derLength(total), ...inner, ...der]);
}

/** A GitHub App JWT from a PKCS#1 or PKCS#8 private key. */
export async function githubAppJwt(
  appId: string,
  privateKey: string,
  now: Date,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    ownedBuffer(pkcs8FromPem(privateKey)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const seconds = Math.floor(now.getTime() / 1000);
  const segment = (value: unknown) =>
    encodeBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${segment({ alg: "RS256", typ: "JWT" })}.${segment({
    iat: seconds - 60,
    exp: seconds + 540,
    iss: appId,
  })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

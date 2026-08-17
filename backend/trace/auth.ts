import type { ApiRole, AuthenticatedActor } from "./contracts";

export type ApiTokenClaims = {
  iss: "slop.cash";
  aud: "private-trace-api";
  sub: `github:${string}`;
  githubId: string;
  githubLogin: string;
  roles: ApiRole[];
  iat: number;
  exp: number;
  jti: string;
};

const encoder = new TextEncoder();
const CONTRIBUTOR_MAX_TTL_SECONDS = 10 * 60;
const OPERATOR_MAX_TTL_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_PAYLOAD_CHARS = 4096;
const HMAC_SHA256_BASE64URL_CHARS = 43;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function secretBytes(secret: string): Uint8Array {
  // This secret was originally provisioned as opaque high-entropy text and
  // used byte-for-byte as the HMAC key. Preserve that key material across the
  // stricter validation rollout; decoding an existing base64-looking value
  // silently changes the key and invalidates every token.
  if (!/^[\x21-\x7e]{32,128}$/u.test(secret)) {
    throw new Error(
      "TRACE_AUTH_SECRET must be 32-128 printable ASCII characters",
    );
  }
  return encoder.encode(secret);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ownedBuffer(secretBytes(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function validClaims(value: unknown): value is ApiTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Partial<ApiTokenClaims>;
  const roles = claims.roles;
  return (
    Object.keys(value).sort().join("\0") ===
      "aud\0exp\0githubId\0githubLogin\0iat\0iss\0jti\0roles\0sub" &&
    claims.iss === "slop.cash" &&
    claims.aud === "private-trace-api" &&
    typeof claims.sub === "string" &&
    claims.sub === `github:${claims.githubId}` &&
    typeof claims.githubId === "string" &&
    /^\d+$/u.test(claims.githubId) &&
    typeof claims.githubLogin === "string" &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(claims.githubLogin) &&
    Array.isArray(roles) &&
    roles.length > 0 &&
    new Set(roles).size === roles.length &&
    roles.every((role) =>
      ["contributor", "project_owner", "operator"].includes(role),
    ) &&
    typeof claims.iat === "number" &&
    Number.isInteger(claims.iat) &&
    typeof claims.exp === "number" &&
    Number.isInteger(claims.exp) &&
    claims.exp > claims.iat &&
    typeof claims.jti === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/u.test(claims.jti)
  );
}

export async function verifyApiToken(input: {
  authorization: string | null;
  secret: string;
  operatorGithubIds: ReadonlySet<string>;
  nowSeconds: number;
}): Promise<AuthenticatedActor | null> {
  secretBytes(input.secret);
  if (
    input.authorization === null ||
    input.authorization.length >
      "Bearer v1..".length +
        MAX_TOKEN_PAYLOAD_CHARS +
        HMAC_SHA256_BASE64URL_CHARS
  ) {
    return null;
  }
  const match = /^Bearer v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(
    input.authorization,
  );
  if (
    match === null ||
    match[1].length > MAX_TOKEN_PAYLOAD_CHARS ||
    match[2].length !== HMAC_SHA256_BASE64URL_CHARS
  ) {
    return null;
  }

  let payloadBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    payloadBytes = decodeBase64Url(match[1]);
    signature = decodeBase64Url(match[2]);
  } catch {
    return null;
  }

  const verified = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(input.secret),
    ownedBuffer(signature),
    encoder.encode(`v1.${match[1]}`),
  );
  if (!verified) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!validClaims(claims)) return null;

  const maxTtl = claims.roles.includes("operator")
    ? OPERATOR_MAX_TTL_SECONDS
    : CONTRIBUTOR_MAX_TTL_SECONDS;
  if (
    claims.iat > input.nowSeconds + CLOCK_SKEW_SECONDS ||
    claims.exp <= input.nowSeconds - CLOCK_SKEW_SECONDS ||
    claims.exp - claims.iat > maxTtl
  ) {
    return null;
  }

  const roles = claims.roles.filter(
    (role) =>
      role !== "operator" || input.operatorGithubIds.has(claims.githubId),
  );
  if (roles.length === 0) return null;
  return {
    githubId: claims.githubId,
    githubLogin: claims.githubLogin,
    roles,
    tokenId: claims.jti,
  };
}

/** Token issuance belongs in the GitHub-authenticated identity service. */
export async function signApiToken(
  claims: ApiTokenClaims,
  secret: string,
): Promise<string> {
  secretBytes(secret);
  if (!validClaims(claims)) throw new Error("Invalid API token claims");
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret),
      encoder.encode(`v1.${payload}`),
    ),
  );
  return `v1.${payload}.${encodeBase64Url(signature)}`;
}

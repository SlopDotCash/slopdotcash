const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");
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
  const bytes = decodeBase64Url(secret);
  if (bytes.byteLength !== 32)
    throw new Error("Identity secret must be 32 bytes");
  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
    ),
  );
}

export async function encryptPkceVerifier(
  verifier: string,
  flowId: string,
  secret: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(secretBytes(secret)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(iv),
      additionalData: encoder.encode(`slop-identity-pkce:v1:${flowId}`),
    },
    key,
    encoder.encode(verifier),
  );
  return {
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    iv: encodeBase64Url(iv),
  };
}

export async function decryptPkceVerifier(
  ciphertext: string,
  iv: string,
  flowId: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(secretBytes(secret)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(decodeBase64Url(iv)),
      additionalData: encoder.encode(`slop-identity-pkce:v1:${flowId}`),
    },
    key,
    ownedBuffer(decodeBase64Url(ciphertext)),
  );
  const verifier = decoder.decode(plaintext);
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(verifier)) {
    throw new Error("Stored PKCE verifier is invalid");
  }
  return verifier;
}

export async function deriveAssertionToken(
  flowId: string,
  pollCapability: string,
  githubActorId: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(secretBytes(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        `slop-identity-assertion:v1:${flowId}:${pollCapability}:${githubActorId}`,
      ),
    ),
  );
  return `slop_assert_v1_${encodeBase64Url(signature)}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

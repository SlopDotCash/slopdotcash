// spec/backend/identity.md, "The callback claims a pending flow once and clears its verifier before contacting GitHub"

const rs256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** @throws {never} */
function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/** @throws {never} */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** @throws {Error} */
export function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer> {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const body = pem.replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/gu, "").replace(/\s+/gu, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(body)) throw new Error("The private key is not PEM text");
  const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  if (!pkcs1) return der;
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const inner = [0x02, 0x01, 0x00, ...algorithm, 0x04, ...derLength(der.length)];
  return new Uint8Array([0x30, ...derLength(inner.length + der.length), ...inner, ...der]);
}

export async function rs256Signature(pem: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8FromPem(pem), rs256, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign(rs256, key, new TextEncoder().encode(data)));
}

async function aesKey(raw: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", owned(raw), "AES-GCM", false, [usage]);
}

export async function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plain: Uint8Array, aad: string): Promise<Uint8Array> {
  const parameters = { name: "AES-GCM", iv: owned(iv), additionalData: new TextEncoder().encode(aad) };
  return new Uint8Array(await crypto.subtle.encrypt(parameters, await aesKey(key, "encrypt"), owned(plain)));
}

export async function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  const parameters = { name: "AES-GCM", iv: owned(iv), additionalData: new TextEncoder().encode(aad) };
  return new Uint8Array(await crypto.subtle.decrypt(parameters, await aesKey(key, "decrypt"), owned(sealed)));
}

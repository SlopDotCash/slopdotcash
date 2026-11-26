import type { EdgeCache, ExecutionContext } from "../bindings.ts";

/** @throws {never} */
export function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** @throws {never} */
export function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @throws {never} */
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** @throws {never} */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

const rs256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export async function githubAppJwt(pkcs8Hex: string, appId: string, nowSeconds: number): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", hexBytes(pkcs8Hex), rs256, false, ["sign"]);
  const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId })}`;
  const signature = new Uint8Array(await crypto.subtle.sign(rs256, key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${base64Url(signature)}`;
}

export async function verifiedJwt(spkiHex: string, jwt: string): Promise<unknown> {
  const [header = "", payload = "", signature = ""] = jwt.split(".");
  const key = await crypto.subtle.importKey("spki", hexBytes(spkiHex), rs256, false, ["verify"]);
  const valid = await crypto.subtle.verify(rs256, key, fromBase64Url(signature), new TextEncoder().encode(`${header}.${payload}`));
  return valid ? JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) : undefined;
}

export async function seal(keyHex: string, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return `${bytesHex(iv)}:${bytesHex(sealed)}`;
}

export async function open(keyHex: string, sealed: string): Promise<string> {
  const [iv = "", body = ""] = sealed.split(":");
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexBytes(iv) }, key, hexBytes(body)));
}

/** @throws {never} */
export function edgeCache(): EdgeCache {
  return (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
}

/** @throws {never} */
export function cacheKey(origin: string, path: string): Request {
  return new Request(`${origin}/__spike-cache${path}`, { method: "GET" });
}

/** @throws {never} */
export function cacheable(body: string, seconds: number): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain", "cache-control": `public, s-maxage=${seconds}` } });
}

/** @throws {never} */
export function keep(context: ExecutionContext, run: () => Promise<unknown>): void {
  context.waitUntil(run());
}

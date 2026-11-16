/** Ephemeral authenticated transport for exact reviewed packet objects. */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { sha256Hex } from "../src/lib/sha256";
import {
  PacketPreviewError,
  type PrivatePacketManifest,
  parsePrivatePacketManifest,
  privatePacketStore,
} from "./private-payout-packet";

const previewName = "slop-reviewed-packet-preview";
const bucketName = "slop-vetting-evidence";
const prefix = "reviewed-payouts/v1";
function objectDescription(text: string, suffix: string) {
  const manifest = parsePrivatePacketManifest(text);
  const description =
    suffix === "manifest.json"
      ? {
          bytes: new TextEncoder().encode(text).length,
          sha256: sha256Hex(text),
        }
      : /^(0|[1-9][0-9]*)\.gzpart$/u.test(suffix)
        ? manifest.chunks[Number(suffix.split(".")[0])]
        : undefined;
  if (!description) throw new PacketPreviewError("object");
  const key = `${prefix}/${manifest.rawSha256}/${manifest.compressedSha256}/${suffix}`;
  return { ...description, key, aad: `${key}\0${sha256Hex(text)}` };
}

function nonceFor(key: Uint8Array, aad: string, plainDigest: string) {
  if (key.length !== 32) throw new PacketPreviewError("binding");
  return createHmac("sha256", key)
    .update(`slop-packet-nonce-v1\0${aad}\0${plainDigest}`)
    .digest()
    .subarray(0, 12);
}

/** Nonces bind one exact plaintext digest, object path and manifest to this key. */
export function encryptPacketObject(
  text: string,
  suffix: string,
  plain: Uint8Array,
  key: Uint8Array,
) {
  const object = objectDescription(text, suffix);
  if (plain.length !== object.bytes || sha256Hex(plain) !== object.sha256)
    throw new PacketPreviewError("object");
  const nonce = nonceFor(key, object.aad, object.sha256);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(object.aad));
  return Buffer.concat([
    nonce,
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

export function decryptPacketObject(
  text: string,
  suffix: string,
  frame: Uint8Array,
  key: Uint8Array,
) {
  const object = objectDescription(text, suffix);
  const nonce = nonceFor(key, object.aad, object.sha256);
  try {
    if (
      frame.length !== object.bytes + 28 ||
      !Buffer.from(frame.subarray(0, 12)).equals(nonce)
    )
      throw Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(object.aad));
    decipher.setAuthTag(frame.subarray(frame.length - 16));
    const plain = Buffer.concat([
      decipher.update(frame.subarray(12, -16)),
      decipher.final(),
    ]);
    if (plain.length !== object.bytes || sha256Hex(plain) !== object.sha256)
      throw Error();
    return plain;
  } catch {
    throw new PacketPreviewError("object");
  }
}

/** The ephemeral worker can reach only ciphertext in its exact object inventory. */
export function privatePacketWorker(text: string, encryptionKey: Uint8Array) {
  const manifest = parsePrivatePacketManifest(text);
  const names = [
    "manifest.json",
    ...manifest.chunks.map((_, index) => `${index}.gzpart`),
  ];
  const objects = Object.fromEntries(
    names.map((name) => {
      const object = objectDescription(text, name);
      return [
        name,
        {
          bytes: object.bytes + 28,
          nonce: nonceFor(encryptionKey, object.aad, object.sha256).toString(
            "hex",
          ),
        },
      ];
    }),
  );
  return `
const objects = ${JSON.stringify(objects)};
const prefix = ${JSON.stringify(`${prefix}/${manifest.rawSha256}/${manifest.compressedSha256}/`)};
const headers = {"cache-control":"private, no-store", "content-type":"application/octet-stream", "x-content-type-options":"nosniff"};
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2,"0")).join("");
async function exact(body, expected) {
  if (!body) return null;
  const reader = body.getReader(); const parts=[]; let size=0;
  try {
    while (true) {
      const item=await reader.read(); if (item.done) break;
      size+=item.value.byteLength;
      if (size>expected.bytes) { void reader.cancel().catch(()=>{}); return null; }
      parts.push(item.value);
    }
  } finally { reader.releaseLock(); }
  if (size!==expected.bytes) return null;
  const bytes=new Uint8Array(size); let offset=0;
  for (const part of parts) { bytes.set(part,offset); offset+=part.byteLength; }
  const nonce=Array.from(bytes.subarray(0,12),byte=>byte.toString(16).padStart(2,"0")).join("");
  return nonce===expected.nonce ? bytes : null;
}
export default {
  async fetch(request, env) {
    if (!env.PACKET_AUTH || request.headers.get("authorization")!=="Bearer "+env.PACKET_AUTH) return new Response(null,{status:403,headers});
    const url=new URL(request.url); const suffix=url.pathname.slice("/packet/".length);
    if (url.search || !url.pathname.startsWith("/packet/") || !Object.hasOwn(objects,suffix) || !["GET","PUT"].includes(request.method)) return new Response(null,{status:404,headers});
    const expected=objects[suffix]; const key=prefix+suffix;
    try {
      if (!env.PACKET_STORE) return new Response(null,{status:503,headers});
      let incoming;
      if (request.method==="PUT") {
        incoming=await exact(request.body,expected);
        if (!incoming) return new Response(null,{status:400,headers});
        const before=await env.PACKET_STORE.get(key);
        if (!before) await env.PACKET_STORE.put(key,incoming,{onlyIf:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/octet-stream"}});
      }
      const stored=await env.PACKET_STORE.get(key);
      if (!stored) return new Response(null,{status:404,headers});
      const bytes=await exact(stored.body,expected);
      if (!bytes || (incoming && await hash(incoming)!==await hash(bytes))) return new Response(null,{status:409,headers});
      return request.method==="GET" ? new Response(bytes,{headers}) : Response.json({bytes:expected.bytes},{headers:{"cache-control":"private, no-store"}});
    } catch { return new Response(null,{status:503,headers}); }
  }
};`;
}

async function createPacketPreview(
  account: string,
  token: string,
  text: string,
  encryptionKey: Uint8Array,
  request: typeof fetch,
) {
  if (!/^[a-f0-9]{32}$/u.test(account) || !token)
    throw new PacketPreviewError("session");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  async function api(
    path: string,
    operation: "binding" | "session" | "upload" | "object",
    init: RequestInit = {},
  ) {
    let response: Response;
    try {
      response = await request(base + path, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new PacketPreviewError(operation);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true)
      throw new PacketPreviewError(operation, response.status);
    return body.result;
  }
  const subdomain = (await api("/workers/subdomain", "session"))?.subdomain;
  if (typeof subdomain !== "string" || !/^[a-z0-9-]+$/u.test(subdomain))
    throw new PacketPreviewError("session");
  const session = await api(
    `/workers/scripts/${previewName}/subdomain/edge-preview`,
    "session",
  );
  let sessionToken = session?.token;
  let hostname = `${previewName}.${subdomain}.workers.dev`;
  if (session?.exchange_url) {
    const url = new URL(session.exchange_url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      ![".workers.dev", ".cloudflareworkers.com"].some((suffix) =>
        url.hostname.endsWith(suffix),
      )
    )
      throw new PacketPreviewError("session");
    hostname = previewName + url.hostname.slice(url.hostname.indexOf("."));
    try {
      const response = await request(url.href, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (typeof body?.token === "string" && body.token)
        sessionToken = body.token;
    } catch {
      /* The original authenticated session token remains valid. */
    }
  }
  if (typeof sessionToken !== "string" || !sessionToken)
    throw new PacketPreviewError("session");
  const auth = randomBytes(32).toString("base64url");
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      main_module: "packet.js",
      bindings: [
        { name: "PACKET_STORE", type: "r2_bucket", bucket_name: bucketName },
        { name: "PACKET_AUTH", type: "secret_text", text: auth },
      ],
      compatibility_date: "2026-10-01",
    }),
  );
  form.set(
    "packet.js",
    new File([privatePacketWorker(text, encryptionKey)], "packet.js", {
      type: "application/javascript+module",
    }),
  );
  form.set(
    "wrangler-session-config",
    JSON.stringify({ workers_dev: true, minimal_mode: true }),
  );
  const uploaded = await api(
    `/workers/scripts/${previewName}/edge-preview`,
    "upload",
    {
      method: "POST",
      headers: { "cf-preview-upload-config-token": sessionToken },
      body: form,
    },
  );
  if (typeof uploaded?.preview_token !== "string" || !uploaded.preview_token)
    throw new PacketPreviewError("upload");
  return async (suffix: string, method: "GET" | "PUT", bytes?: Uint8Array) => {
    let response: Response;
    try {
      response = await request(`https://${hostname}/packet/${suffix}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${auth}`,
          "cf-workers-preview-token": uploaded.preview_token,
          "content-type": "application/octet-stream",
        },
        ...(bytes ? { body: bytes as BodyInit } : {}),
      });
    } catch {
      throw new PacketPreviewError("object");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new PacketPreviewError("object", response.status);
    const manifest = parsePrivatePacketManifest(text);
    const expected =
      suffix === "manifest.json"
        ? new TextEncoder().encode(text).length + 28
        : (manifest.chunks[Number(suffix.split(".")[0])]?.bytes ?? 0) + 28;
    const maximum = method === "PUT" ? 160 : expected;
    if (!maximum || !response.body) throw new PacketPreviewError("object");
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.byteLength;
        if (length > maximum) {
          void reader.cancel().catch(() => {});
          throw new PacketPreviewError("object");
        }
        parts.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (method === "GET" && length !== expected)
      throw new PacketPreviewError("object");
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.byteLength;
    }
    return result;
  };
}

/** Existing private scanner storage is used only under a separate operational prefix. */
export function privatePacketPreviewStorage(
  account: string,
  token: string,
  request: typeof fetch = fetch,
  encryptionSecret = process.env.PRIVATE_PACKET_ENCRYPTION_KEY ?? "",
) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encryptionSecret))
    throw new PacketPreviewError("binding");
  const encryptionKey = Buffer.from(encryptionSecret, "base64url");
  if (
    encryptionKey.length !== 32 ||
    encryptionKey.toString("base64url") !== encryptionSecret
  )
    throw new PacketPreviewError("binding");
  const config = Bun.TOML.parse(readFileSync("wrangler.toml", "utf8")) as {
    r2_buckets?: { binding: string; bucket_name: string }[];
  };
  if (
    !config.r2_buckets?.some(
      (binding) =>
        binding.binding === "VETTING_EVIDENCE" &&
        binding.bucket_name === bucketName,
    )
  )
    throw new PacketPreviewError("binding");
  let current:
    | { text: string; call: ReturnType<typeof createPacketPreview> }
    | undefined;
  function session(manifest: PrivatePacketManifest) {
    const text = JSON.stringify(manifest);
    if (!current || current.text !== text)
      current = {
        text,
        call: createPacketPreview(account, token, text, encryptionKey, request),
      };
    return current.call;
  }
  return privatePacketStore({
    async check() {},
    async get(manifest, suffix) {
      const frame = await (await session(manifest))(suffix, "GET");
      return frame
        ? decryptPacketObject(
            JSON.stringify(manifest),
            suffix,
            frame,
            encryptionKey,
          )
        : null;
    },
    async putExact(manifest, suffix, bytes) {
      const call = await session(manifest);
      const text = JSON.stringify(manifest);
      const frame = encryptPacketObject(text, suffix, bytes, encryptionKey);
      await call(suffix, "PUT", frame);
      const storedFrame = await call(suffix, "GET");
      const stored = storedFrame
        ? decryptPacketObject(text, suffix, storedFrame, encryptionKey)
        : null;
      if (
        !stored ||
        stored.length !== bytes.length ||
        sha256Hex(stored) !== sha256Hex(bytes)
      )
        throw new PacketPreviewError("object");
    },
  });
}

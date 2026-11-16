/** Private owner-reviewed packet transport through a fixed operational R2 bucket. */
import { execFileSync } from "node:child_process";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { sha256Hex } from "../src/lib/sha256";

const BUCKET = "slop-reviewed-payouts";
type StorageOperation =
  | "bucket-read"
  | "bucket-create"
  | "managed-domain-read"
  | "custom-domain-read"
  | "object-read"
  | "object-write";
type StagingPhase =
  | "trusted-context"
  | "source-check"
  | "credentials"
  | "manifest"
  | "chunk-stage"
  | "completion-read";
class PrivatePacketRequestError extends Error {
  constructor(
    readonly operation: StorageOperation,
    readonly httpStatus: number | null,
    readonly cloudflareCode: number | null,
  ) {
    super("Private packet storage request refused");
  }
}
export class PacketPreviewError extends Error {
  constructor(
    readonly operation: "binding" | "session" | "upload" | "object",
    readonly status: number | null = null,
  ) {
    super("Private packet preview refused");
  }
}
export function safePacketPreviewFailure(error: unknown) {
  return error instanceof PacketPreviewError
    ? { operation: error.operation, httpStatus: error.status }
    : null;
}
/** Emit fixed stage names and numeric status codes without external error text. */
export function privatePacketFailure(phase: StagingPhase, error: unknown) {
  return {
    error: "private_packet_staging_refused",
    phase,
    ...(error instanceof PrivatePacketRequestError
      ? {
          storage: {
            operation: error.operation,
            httpStatus: error.httpStatus,
            cloudflareCode: error.cloudflareCode,
          },
        }
      : {}),
    ...(safePacketPreviewFailure(error)
      ? { preview: safePacketPreviewFailure(error) }
      : {}),
  };
}
export interface PrivatePacketManifest {
  schemaVersion: "1";
  /** Omitted on retained gzip manifests. */
  compression?: "br";
  rawSha256: string;
  rawBytes: number;
  compressedSha256: string;
  compressedBytes: number;
  chunks: { sha256: string; bytes: number }[];
}
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
export function parsePrivatePacketManifest(
  text: string,
): PrivatePacketManifest {
  const value = JSON.parse(text) as PrivatePacketManifest;
  const digest = (v: unknown) =>
    typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
  const size = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
  requireThat(
    value &&
      Object.keys(value).sort().join(",") ===
        (value.compression === "br"
          ? "chunks,compressedBytes,compressedSha256,compression,rawBytes,rawSha256,schemaVersion"
          : "chunks,compressedBytes,compressedSha256,rawBytes,rawSha256,schemaVersion") &&
      value.schemaVersion === "1" &&
      digest(value.rawSha256) &&
      digest(value.compressedSha256) &&
      size(value.rawBytes) &&
      size(value.compressedBytes) &&
      Array.isArray(value.chunks) &&
      value.chunks.length > 0 &&
      value.chunks.every(
        (chunk) =>
          Object.keys(chunk).sort().join(",") === "bytes,sha256" &&
          digest(chunk.sha256) &&
          size(chunk.bytes) &&
          chunk.bytes <= 393216,
      ) &&
      value.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) ===
        value.compressedBytes &&
      JSON.stringify(value) === text,
    "Invalid private packet manifest",
  );
  return value;
}
export function privatePayoutStorage(
  account: string,
  token: string,
  request: typeof fetch = fetch,
) {
  requireThat(
    /^[a-f0-9]{32}$/u.test(account) && token,
    "Private packet credentials unavailable",
  );
  const root = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
  async function call(
    path: string,
    operation: StorageOperation,
    method = "GET",
    body?: Uint8Array | string,
  ) {
    let response: Response;
    try {
      response = await request(root + path, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type":
            typeof body === "string"
              ? "application/json"
              : "application/octet-stream",
        },
        ...(body === undefined ? {} : { body: body as BodyInit }),
      });
    } catch {
      throw new PrivatePacketRequestError(operation, null, null);
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        errors?: { code?: unknown }[];
      } | null;
      const code = body?.errors?.[0]?.code;
      throw new PrivatePacketRequestError(
        operation,
        response.status,
        Number.isSafeInteger(code) ? Number(code) : null,
      );
    }
    return response;
  }
  async function json(
    path: string,
    operation: StorageOperation,
    method = "GET",
    body?: string,
  ) {
    const response = await call(path, operation, method, body);
    if (!response) return null;
    const value = (await response.json()) as {
      success?: boolean;
      result?: unknown;
      errors?: { code?: unknown }[];
    };
    if (value.success !== true) {
      const code = value.errors?.[0]?.code;
      throw new PrivatePacketRequestError(
        operation,
        response.status,
        Number.isSafeInteger(code) ? Number(code) : null,
      );
    }
    return value.result;
  }
  async function privateBucket(create = false) {
    let bucket = (await json(`/${BUCKET}`, "bucket-read")) as {
      name?: string;
    } | null;
    if (!bucket && create) {
      await json("", "bucket-create", "POST", JSON.stringify({ name: BUCKET }));
      bucket = (await json(`/${BUCKET}`, "bucket-read")) as {
        name?: string;
      } | null;
    }
    requireThat(bucket?.name === BUCKET, "Private packet bucket unavailable");
    const managed = (await json(
      `/${BUCKET}/domains/managed`,
      "managed-domain-read",
    )) as {
      enabled?: boolean;
    } | null;
    const custom = (await json(
      `/${BUCKET}/domains/custom`,
      "custom-domain-read",
    )) as {
      domains?: unknown[];
    } | null;
    requireThat(
      managed?.enabled === false &&
        Array.isArray(custom?.domains) &&
        custom.domains.length === 0,
      "Packet bucket must remain private",
    );
  }
  const key = (manifest: PrivatePacketManifest, suffix: string) =>
    `/${BUCKET}/objects/${manifest.rawSha256}/${manifest.compressedSha256}/${suffix}`;
  async function get(manifest: PrivatePacketManifest, suffix: string) {
    const response = await call(key(manifest, suffix), "object-read");
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }
  async function putExact(
    manifest: PrivatePacketManifest,
    suffix: string,
    bytes: Uint8Array,
  ) {
    const before = await get(manifest, suffix);
    if (before)
      requireThat(
        sha256Hex(before) === sha256Hex(bytes),
        "Stored private packet bytes differ",
      );
    else await call(key(manifest, suffix), "object-write", "PUT", bytes);
    const after = await get(manifest, suffix);
    requireThat(
      after &&
        after.length === bytes.length &&
        sha256Hex(after) === sha256Hex(bytes),
      "Private packet upload did not reconcile",
    );
  }
  return privatePacketStore({ check: privateBucket, get, putExact });
}

/** The reviewed packet codec is shared by the two explicit private transports. */
export function privatePacketStore(storage: {
  check: (create?: boolean) => Promise<void>;
  get: (
    manifest: PrivatePacketManifest,
    suffix: string,
  ) => Promise<Uint8Array | null>;
  putExact: (
    manifest: PrivatePacketManifest,
    suffix: string,
    bytes: Uint8Array,
  ) => Promise<void>;
}) {
  return {
    async stage(text: string, index: number, encoded: string) {
      const manifest = parsePrivatePacketManifest(text);
      requireThat(
        Number.isSafeInteger(index) &&
          index >= 0 &&
          index < manifest.chunks.length,
        "Invalid private chunk index",
      );
      requireThat(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
          encoded,
        ),
        "Invalid private chunk encoding",
      );
      const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
      const expected = manifest.chunks[index];
      requireThat(
        bytes.length === expected.bytes && sha256Hex(bytes) === expected.sha256,
        "Private chunk differs from manifest",
      );
      await storage.check(true);
      await storage.putExact(
        manifest,
        "manifest.json",
        new TextEncoder().encode(text),
      );
      await storage.putExact(manifest, `${index}.gzpart`, bytes);
      await storage.check();
      return { rawSha256: manifest.rawSha256, chunk: index, verified: true };
    },
    async read(text: string) {
      const manifest = parsePrivatePacketManifest(text);
      await storage.check();
      const stored = await storage.get(manifest, "manifest.json");
      requireThat(
        stored && new TextDecoder().decode(stored) === text,
        "Stored private manifest differs",
      );
      const chunks: Uint8Array[] = [];
      for (const [index, expected] of manifest.chunks.entries()) {
        const bytes = await storage.get(manifest, `${index}.gzpart`);
        requireThat(
          bytes &&
            bytes.length === expected.bytes &&
            sha256Hex(bytes) === expected.sha256,
          "Private packet chunk is absent or changed",
        );
        chunks.push(bytes);
      }
      const compressed = Buffer.concat(chunks);
      requireThat(
        compressed.length === manifest.compressedBytes &&
          sha256Hex(compressed) === manifest.compressedSha256,
        "Private packet compression binding differs",
      );
      const decoder =
        manifest.compression === "br"
          ? createBrotliDecompress()
          : createGunzip();
      const raw: Buffer[] = [];
      let length = 0;
      const result = (async () => {
        for await (const data of decoder) {
          length += data.length;
          requireThat(
            length <= manifest.rawBytes,
            "Private packet exceeds its exact reviewed size",
          );
          raw.push(data);
        }
      })();
      decoder.end(compressed);
      await result;
      const bytes = Buffer.concat(raw);
      requireThat(
        length === manifest.rawBytes && sha256Hex(bytes) === manifest.rawSha256,
        "Private packet raw binding differs",
      );
      await storage.check();
      return bytes;
    },
  };
}
/** Select only the transport explicitly named by the protected workflow. */
export async function reviewedPacketStorage(account: string, token: string) {
  const transport = process.env.PRIVATE_PACKET_TRANSPORT;
  if (!transport || transport === "r2-api")
    return privatePayoutStorage(account, token);
  requireThat(
    transport === "bound-preview",
    "Unknown private packet transport",
  );
  const { privatePacketPreviewStorage } = await import(
    "./private-packet-preview"
  );
  return privatePacketPreviewStorage(account, token);
}

if (import.meta.main) {
  let phase: StagingPhase = "trusted-context";
  try {
    requireThat(
      process.env.GITHUB_ACTIONS === "true" &&
        process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        process.env.GITHUB_REF === "refs/heads/main",
      "Require trusted main packet staging",
    );
    phase = "source-check";
    const current = execFileSync(
      "git",
      ["ls-remote", "origin", "refs/heads/main"],
      { encoding: "utf8", timeout: 30000 },
    ).split(/\s/u)[0];
    const checkout = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    requireThat(
      checkout === process.env.GITHUB_SHA && current === checkout,
      "Private packet staging source changed",
    );
    const encoded = Array.from(
      { length: 16 },
      (_, n) => process.env[`PRIVATE_PACKET_CHUNK_${n + 1}`] ?? "",
    ).join("");
    phase = "credentials";
    const storage = await reviewedPacketStorage(
      process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      process.env.CLOUDFLARE_API_TOKEN ?? "",
    );
    phase = "manifest";
    const manifestText = process.env.PRIVATE_PACKET_MANIFEST ?? "";
    const manifest = parsePrivatePacketManifest(manifestText);
    const index = Number(process.env.PRIVATE_PACKET_CHUNK_INDEX);
    phase = "chunk-stage";
    const result = await storage.stage(manifestText, index, encoded);
    const complete = index === manifest.chunks.length - 1;
    if (complete) {
      phase = "completion-read";
      await storage.read(manifestText);
    }
    console.log(JSON.stringify({ ...result, complete }));
  } catch (error) {
    console.error(JSON.stringify(privatePacketFailure(phase, error)));
    process.exitCode = 1;
  }
}

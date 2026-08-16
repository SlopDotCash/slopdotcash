import {
  isExactClientIdentifier,
  isExactClientVersion,
  isExactModelIdentifier,
  isExactProviderIdentifier,
} from "../../src/lib/model-identity";
import {
  MAX_JSON_BYTES,
  MAX_TRACE_BYTES,
  RUN_EVENT_KINDS,
  type RunEventKind,
  TRACE_CONTENT_TYPES,
  type TraceContentType,
} from "./contracts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export {
  isExactClientIdentifier,
  isExactClientVersion,
  isExactModelIdentifier,
  isExactProviderIdentifier,
};

export function validRepository(value: unknown): value is string {
  return typeof value === "string" && REPOSITORY_PATTERN.test(value);
}

export function validGitSha(value: unknown): value is string {
  return typeof value === "string" && GIT_SHA_PATTERN.test(value);
}

export function validSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_PATTERN.test(value);
}

export function validContentType(value: string): value is TraceContentType {
  const base = value.split(";", 1)[0].trim().toLowerCase();
  return TRACE_CONTENT_TYPES.some((item) => item === base);
}

export function normalizedContentType(value: string): TraceContentType {
  const base = value.split(";", 1)[0].trim().toLowerCase();
  if (!validContentType(base))
    throw new Error("Unsupported trace content type");
  return base;
}

export function validEventKind(value: unknown): value is RunEventKind {
  return RUN_EVENT_KINDS.some((kind) => kind === value);
}

export function validIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const bytes = await readLimitedBody(request, MAX_JSON_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Request body must be valid UTF-8 JSON");
  }
  if (!isRecord(value)) throw new Error("Request body must be a JSON object");
  return value;
}

export async function readTraceBody(request: Request): Promise<Uint8Array> {
  const bytes = await readLimitedBody(request, MAX_TRACE_BYTES);
  if (bytes.byteLength === 0) throw new Error("Trace body must not be empty");
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return bytes;
}

async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > limit) {
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel("body too large");
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", copy.buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

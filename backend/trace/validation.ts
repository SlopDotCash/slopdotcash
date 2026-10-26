import { readBoundedBytes } from "../../src/lib/browser-json";
import { isRecord } from "../../src/lib/record-validation.mjs";

export { isRecord } from "../../src/lib/record-validation.mjs";

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

class RequestBodyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
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

function validContentType(value: string): value is TraceContentType {
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
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    return false;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = value.endsWith(".000Z")
    ? value
    : value.endsWith("Z") && !value.includes(".")
      ? `${value.slice(0, -1)}.000Z`
      : value;
  return new Date(milliseconds).toISOString() === canonical;
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const bytes = await readLimitedBody(request, MAX_JSON_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestBodyError(
      400,
      "invalid_request",
      "Request body must be valid UTF-8 JSON",
    );
  }
  if (!isRecord(value))
    throw new RequestBodyError(
      400,
      "invalid_request",
      "Request body must be a JSON object",
    );
  return value;
}

export async function readTraceBody(request: Request): Promise<Uint8Array> {
  const bytes = await readLimitedBody(request, MAX_TRACE_BYTES);
  if (bytes.byteLength === 0)
    throw new RequestBodyError(
      400,
      "invalid_request",
      "Trace body must not be empty",
    );
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError(
      400,
      "invalid_request",
      "Trace body must be valid UTF-8",
    );
  }
  return bytes;
}

export async function readLimitedBody(
  request: Pick<Request, "headers" | "body">,
  limit: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/u.test(declared))
    throw new RequestBodyError(
      400,
      "invalid_content_length",
      "Content-Length must contain only decimal digits",
    );
  if (request.body === null) return new Uint8Array();
  try {
    return await readBoundedBytes(request, limit, "Request body");
  } catch (error) {
    if (error instanceof RangeError)
      throw new RequestBodyError(
        413,
        "payload_too_large",
        `Request body exceeds ${limit} bytes`,
      );
    throw error;
  }
}

export { sha256Hex } from "../../src/lib/async-sha256.mjs";

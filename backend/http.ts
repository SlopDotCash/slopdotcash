/** Transport helpers shared by the API handlers behind the Pages entry. */

import { readBoundedJson } from "../src/lib/browser-json";

/** Expected request refusals; each API keeps its own log label. */
export type ApiError = Error & { status?: number; code?: string };
export function fail(status: number, code: string, message: string): never {
  const error: ApiError = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

/** Split versioned API paths consistently across service handlers. */
export function pathParts(request: Request): string[] {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/v1/")) return [];
  return path.slice("/api/v1/".length).split("/").filter(Boolean);
}

/**
 * A registry project id: at most MAX_PROJECT_ID_LENGTH (43) characters, as in
 * `src/lib/project-schema.mjs`. That file is a skill template input, so its
 * pattern is not exported from there.
 */
export const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]{0,41}[a-z0-9])?$/u;

/** Headers of an API JSON response; callers may replace the cache policy. */
export const JSON_HEADERS = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export type JsonOptions = {
  /** Defaults to `private, no-store`. */
  cacheControl?: string;
  /** Contract and policy headers that extend or replace the defaults. */
  headers?: Record<string, string>;
};

export function json(
  status: number,
  body: unknown,
  { cacheControl = JSON_HEADERS["cache-control"], headers }: JsonOptions = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": cacheControl, ...headers },
  });
}

/**
 * Session-cookie writes must come from this site as one of the accepted media
 * types, so a cross-site form can never submit one.
 */
export function isSameOriginJsonWrite(
  request: Request,
  mediaTypes: readonly string[] = ["application/json"],
): boolean {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    mediaTypes.includes(
      request.headers.get("content-type")?.split(";")[0] ?? "",
    )
  );
}

/**
 * A bounded JSON object body. A malformed, oversized or non-object body is a
 * client error, so callers answer 400 instead of the 503 their catch-all
 * returns for a failed database or identity operation.
 */
export async function readJsonObject(
  request: Request,
  maximum: number,
  label: string,
): Promise<Record<string, unknown> | null> {
  let value: unknown;
  try {
    value = await readBoundedJson(request, maximum, label);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Splits values into `IN (...)` batches. D1 allows 100 bound parameters per
 * statement, so callers keep a margin.
 */
export function chunked<T>(values: readonly T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    out.push(values.slice(index, index + size));
  return out;
}

export type ApiErrorOptions = {
  /** Fixed log label; never request content, identifiers or secrets. */
  label: string;
  /** The API's own response builder, so its headers stay unchanged. */
  respond?: (status: number, body: Record<string, unknown>) => Response;
  /** A server failure whose message is written for the public. */
  publicMessage?: (
    status: number,
    error: Partial<ApiError>,
    caught: unknown,
  ) => boolean;
  /** Safe server-side detail for the log line. */
  detail?: (status: number) => unknown;
};

/**
 * Maps a refusal to its status and code. A server failure is logged under a
 * fixed label and returns "Internal error" unless its message is public.
 */
export function apiErrorResponse(
  caught: unknown,
  { label, respond = json, publicMessage, detail }: ApiErrorOptions,
): Response {
  const error =
    typeof caught === "object" && caught !== null
      ? (caught as Partial<ApiError>)
      : {};
  const status =
    Number.isSafeInteger(error.status) &&
    Number(error.status) >= 400 &&
    Number(error.status) <= 599
      ? Number(error.status)
      : 500;
  if (status >= 500) {
    if (detail) console.error(label, detail(status));
    else console.error(label);
  }
  return respond(status, {
    error:
      typeof error.code === "string" &&
      /^[a-z][a-z0-9_]{1,63}$/u.test(error.code)
        ? error.code
        : "internal_error",
    message:
      (status >= 500 && publicMessage?.(status, error, caught) !== true) ||
      typeof error.message !== "string"
        ? "Internal error"
        : error.message,
  });
}

export function cookieValue(request: Request, name: string): string | null {
  const found = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return found === undefined ? null : found.slice(name.length + 1);
}

export function exactKeys(
  body: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(body, key)) ||
    Object.keys(body).some((key) => !allowed.has(key))
  )
    fail(400, "invalid_request", "Request body has unexpected fields");
}

export async function requireActor<A extends { githubId: string }>(
  request: Request,
  deps: { sessionActor(request: Request): Promise<A | null> },
): Promise<A> {
  const actor = await deps.sessionActor(request);
  if (actor === null) fail(401, "unauthorized", "Sign in with GitHub");
  // The caller may bind a private request to the actor shown in its UI. This
  // only narrows the authenticated session; it never supplies authority.
  const expected = request.headers.get("x-slop-expected-github-id");
  if (expected !== null) {
    if (!/^[1-9]\d{0,19}$/u.test(expected))
      fail(400, "invalid_expected_actor", "Expected GitHub actor is invalid");
    if (expected !== actor.githubId)
      fail(
        403,
        "actor_changed",
        "Your account changed. Reload your private view before continuing.",
      );
  }
  return actor;
}

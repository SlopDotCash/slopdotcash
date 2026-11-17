// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
import { HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";

const bodiless = new Set([204, 205, 304]);

/** @throws {RangeError} */
export function replayed(request: HttpClientRequest.HttpClientRequest, status: number, headers: Readonly<Record<string, string>>, bytes: Uint8Array): HttpClientResponse.HttpClientResponse {
  return HttpClientResponse.fromWeb(request, new Response(bodiless.has(status) ? null : bytes.slice(), { status, headers: Object.entries(headers) }));
}

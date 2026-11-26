/** Shared constants for trace licensing consent. */
export const TRACE_TERMS_VERSIONS = [
  "private-trace-v1",
  "private-trace-v2",
  "private-trace-v3",
] as const;

export type TraceTermsVersion = (typeof TRACE_TERMS_VERSIONS)[number];

export function isTraceTermsVersion(x: unknown): x is TraceTermsVersion {
  return (
    typeof x === "string" &&
    (TRACE_TERMS_VERSIONS as readonly string[]).includes(x)
  );
}

export const TRACES_ME_API = "/api/v1/traces/me";
export const TRACE_LICENSING_API = "/api/v1/traces/licensing";
export const TRACE_LICENCES_API = "/api/v1/traces/licences";

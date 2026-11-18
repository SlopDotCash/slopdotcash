import { GitHubError, type GitHubSourceReadRefusal } from "./github";

/** PRD 9/11: fixed internal import observations, never evidence or error text. */
export const HISTORICAL_INTAKE_STAGES = [
  "envelope",
  "installation",
  "github-client",
  "source-repository",
  "source-registry",
  "source-installation",
  "source-evidence",
  "source-context",
  "source-policy",
  "bundle-inputs",
  "bundle-file-recovery",
  "bundle-file-client",
  "bundle-source-recollection",
  "bundle-context-recollection",
  "bundle-metadata",
  "bundle-merge-reconstruction",
  "bundle-identity",
  "prepare-work-unit",
  "publish-work-unit",
  "publish-single",
] as const;
export type HistoricalIntakeStage = (typeof HISTORICAL_INTAKE_STAGES)[number];
export type HistoricalIntakeProgress = {
  stage: HistoricalIntakeStage;
  sourceIndex: number | null;
  sourceCount: number | null;
};
const names = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "DOMException",
  "AbortError",
  "TimeoutError",
  "DataError",
  "OperationError",
  "NotSupportedError",
  "InvalidAccessError",
  "DataCloneError",
  "QuotaExceededError",
  "GitHubError",
  "OtherError",
]);
const statuses = new Set([
  400, 401, 403, 404, 408, 409, 413, 415, 422, 429, 500, 502, 503, 504,
]);
export type HistoricalIntakeFailure = HistoricalIntakeProgress & {
  event: "historical-intake-failure";
  errorName: string;
  httpStatus: number | null;
  messageSha256: string | null;
  sourceReadRefusal?: GitHubSourceReadRefusal;
};
const stages = new Set<string>(HISTORICAL_INTAKE_STAGES);
const sourceReadCategories = new Set([
  "primary-rate-limit",
  "secondary-rate-limit",
  "rate-limited",
  "access-denied",
  "unclassified",
]);

function projectSourceReadRefusal(
  value: unknown,
  status: unknown,
): GitHubSourceReadRefusal | null {
  if (
    (status !== 403 && status !== 429) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return null;
  const v = value as GitHubSourceReadRefusal;
  if (
    Object.keys(v).sort().join() !==
      "category,remaining,resetAt,retryAfterSeconds" ||
    !sourceReadCategories.has(v.category) ||
    (v.category === "access-denied" && status !== 403) ||
    (v.category === "rate-limited" && status !== 429) ||
    (v.category === "primary-rate-limit" && v.remaining !== 0) ||
    [v.remaining, v.resetAt, v.retryAfterSeconds].some(
      (field) => field !== null && !(Number.isSafeInteger(field) && field >= 0),
    )
  )
    return null;
  return {
    category: v.category,
    remaining: v.remaining,
    resetAt: v.resetAt,
    retryAfterSeconds: v.retryAfterSeconds,
  };
}

/** Reject extra fields even when an injected transport was already sanitized. */
export function projectHistoricalIntakeFailure(
  value: unknown,
): HistoricalIntakeFailure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const hasSourceReadRefusal = "sourceReadRefusal" in v;
  const sourceReadRefusal = hasSourceReadRefusal
    ? projectSourceReadRefusal(v.sourceReadRefusal, v.httpStatus)
    : null;
  if (
    Object.keys(v).sort().join() !==
      "errorName,event,httpStatus,messageSha256,sourceCount,sourceIndex" +
        (hasSourceReadRefusal ? ",sourceReadRefusal,stage" : ",stage") ||
    (hasSourceReadRefusal && !sourceReadRefusal) ||
    v.event !== "historical-intake-failure" ||
    typeof v.stage !== "string" ||
    !stages.has(v.stage) ||
    typeof v.errorName !== "string" ||
    !names.has(v.errorName)
  )
    return null;
  if (
    v.sourceCount !== null &&
    (!Number.isSafeInteger(v.sourceCount) ||
      Number(v.sourceCount) < 1 ||
      Number(v.sourceCount) > 10000)
  )
    return null;
  if (
    v.sourceIndex !== null &&
    (!Number.isSafeInteger(v.sourceIndex) ||
      Number(v.sourceIndex) < 0 ||
      v.sourceCount === null ||
      Number(v.sourceIndex) >= Number(v.sourceCount))
  )
    return null;
  if (
    v.httpStatus !== null &&
    (typeof v.httpStatus !== "number" || !statuses.has(v.httpStatus))
  )
    return null;
  if (
    v.messageSha256 !== null &&
    (typeof v.messageSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(v.messageSha256))
  )
    return null;
  return {
    event: "historical-intake-failure",
    stage: v.stage as HistoricalIntakeStage,
    sourceIndex: v.sourceIndex as number | null,
    sourceCount: v.sourceCount as number | null,
    errorName: v.errorName,
    httpStatus: v.httpStatus as number | null,
    messageSha256: v.messageSha256 as string | null,
    ...(sourceReadRefusal ? { sourceReadRefusal } : {}),
  };
}
export async function historicalIntakeFailure(
  progress: HistoricalIntakeProgress,
  error: unknown,
): Promise<HistoricalIntakeFailure | null> {
  const e =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const message = e.message;
  let messageSha256: string | null = null;
  if (typeof message === "string" && message.length <= 4096) {
    const bytes = new TextEncoder().encode(message);
    if (bytes.length <= 4096)
      messageSha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
  }
  return projectHistoricalIntakeFailure({
    ...progress,
    event: "historical-intake-failure",
    errorName:
      typeof e.name === "string" && names.has(e.name) ? e.name : "OtherError",
    httpStatus:
      typeof e.status === "number" && statuses.has(e.status) ? e.status : null,
    messageSha256,
    ...(error instanceof GitHubError && error.sourceReadRefusal
      ? { sourceReadRefusal: error.sourceReadRefusal }
      : {}),
  });
}
/** Logging failure cannot replace the original rejection or alter publication. */
export async function withHistoricalIntakeDiagnostics<T>(
  operation: (
    observe: (progress: HistoricalIntakeProgress) => void,
  ) => Promise<T>,
  log: (safe: string) => void = (safe) => console.error(safe),
): Promise<T> {
  let progress: HistoricalIntakeProgress = {
    stage: "envelope",
    sourceIndex: null,
    sourceCount: null,
  };
  try {
    return await operation((current) => {
      progress = current;
    });
  } catch (error) {
    try {
      const safe = await historicalIntakeFailure(progress, error);
      if (safe) log(JSON.stringify(safe));
    } catch {
      /* Original failure remains authoritative. */
    }
    throw error;
  }
}

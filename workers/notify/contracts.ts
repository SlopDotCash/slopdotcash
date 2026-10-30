/**
 * Admin recipients come from the `ADMIN_EMAILS` Worker secret, a
 * comma-separated list that operators configure outside the repository.
 */
export const MAX_ADMIN_RECIPIENTS = 10;
/** The only sender: a plain local part at slop.cash. */
export const SENDER_ADDRESS =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@slop\.cash$/u;
/** A plain recipient address; no display name, comment or route. */
export const EMAIL_ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
export const NOTIFY_INTERNAL_HOST = "notify.internal";
/** Documented pre-acceptance quota errors permit bounded retries. Unknown
 * transport failures may already have sent mail and must not be resent. */
export function retryableEmailRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED"].includes(
      String(error.code),
    )
  );
}
export const PROJECT_APPLICATION_NOTICE_PATH = "/v1/project-applications";
export const MAX_NOTICE_BODY_BYTES = 8 * 1024;
export type { ProjectApplicationNotice } from "../../src/lib/project-contracts";

export const SLOPBOT_SPEND_NOTICE_PATH = "/v1/slopbot-spend";
export const SLOPBOT_FAILURE_NOTICE_PATH = "/v1/slopbot-failure";
export type SlopbotFailureNotice = {
  callId: number;
  model: string;
  kind: "budget-exhausted" | "request-failed";
  occurredAt: string;
  failure?: string;
};

/** Only fixed model-route categories may cross the notification boundary. */
export function safeProviderFailure(value: unknown): string {
  return typeof value === "string" &&
    (value === "provider did not report the requested model" ||
      value === "schema-invalid verdict" ||
      value === "provider budget exhausted" ||
      value === "provider deadline truncated the response" ||
      value === "refusal" ||
      value === "max_tokens" ||
      /^provider returned HTTP [1-5][0-9]{2}$/u.test(value))
    ? value
    : "provider call failed";
}

export function validFailureNotice(
  value: unknown,
): value is SlopbotFailureNotice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join();
  return (
    (keys === "callId,kind,model,occurredAt" ||
      (keys === "callId,failure,kind,model,occurredAt" &&
        typeof v.failure === "string" &&
        safeProviderFailure(v.failure) === v.failure)) &&
    Number.isSafeInteger(v.callId) &&
    Number(v.callId) > 0 &&
    typeof v.model === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(v.model) &&
    (v.kind === "budget-exhausted" || v.kind === "request-failed") &&
    typeof v.occurredAt === "string" &&
    Number.isFinite(Date.parse(v.occurredAt)) &&
    new Date(v.occurredAt).toISOString() === v.occurredAt
  );
}
export const SLOPBOT_SPEND_INTERVAL_MICRO_USD = 500_000_000;
export type SlopbotSpendNotice = {
  month: string;
  thresholdMicroUsd: number;
  recordedMicroUsd: number;
  estimatedCalls: number;
};
export function validSpendNotice(value: unknown): value is SlopbotSpendNotice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join() ===
      "estimatedCalls,month,recordedMicroUsd,thresholdMicroUsd" &&
    typeof v.month === "string" &&
    /^20\d{2}-(0[1-9]|1[0-2])$/u.test(v.month) &&
    Number.isSafeInteger(v.thresholdMicroUsd) &&
    Number(v.thresholdMicroUsd) > 0 &&
    Number(v.thresholdMicroUsd) % SLOPBOT_SPEND_INTERVAL_MICRO_USD === 0 &&
    Number.isSafeInteger(v.recordedMicroUsd) &&
    Number(v.recordedMicroUsd) >= Number(v.thresholdMicroUsd) &&
    Number.isSafeInteger(v.estimatedCalls) &&
    Number(v.estimatedCalls) >= 0
  );
}

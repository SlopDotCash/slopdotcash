/**
 * Admin recipients come from the `ADMIN_EMAILS` Worker secret, a
 * comma-separated list that operators configure outside the repository.
 */
export const MAX_ADMIN_RECIPIENTS = 10;
export const NOTIFY_INTERNAL_HOST = "notify.internal";
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
};
export function validFailureNotice(
  value: unknown,
): value is SlopbotFailureNotice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join() === "callId,kind,model,occurredAt" &&
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

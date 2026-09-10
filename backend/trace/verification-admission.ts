/** Shared, durable admission before public Solana RPC fanout.
 * Reuses the existing atomic identity_rate_limits table. Fixed client buckets
 * cap this policy at 1,025 rows per auth-secret revision; collisions fail closed.
 */
import {
  consumeExactRateLimit,
  type ExactRateLimitResult,
} from "../../workers/identity/rate-limit";
import type { D1Database } from "./cloudflare-persistence";
import type { TracePersistence } from "./contracts";
import { sha256Hex } from "./validation";

export const VERIFICATION_ADMISSION = {
  windowSeconds: 60,
  globalLimit: 24,
  clientLimit: 4,
  clientBuckets: 1024,
  timeoutMs: 2000,
} as const;
export interface VerificationAdmissionInput {
  principal: string;
  secret: string;
  nowEpochSeconds: number;
}
export type VerificationAdmission = () => Promise<Response | null>;
export function verificationAdmissionUnavailable(): Response {
  return denied(503, "verification_admission_unavailable", 60);
}
function denied(status: number, error: string, retry: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(retry),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
export async function consumeVerificationAdmission(
  db: D1Database,
  input: VerificationAdmissionInput,
): Promise<ExactRateLimitResult> {
  const options = {
    db,
    secret: input.secret,
    nowEpochSeconds: input.nowEpochSeconds,
    windowSeconds: VERIFICATION_ADMISSION.windowSeconds,
  };
  const global = await consumeExactRateLimit({
    ...options,
    scope: "public-verification-global-v1",
    principal: "shared",
    limit: VERIFICATION_ADMISSION.globalLimit,
  });
  if (!global.allowed) return global;
  const hash = await sha256Hex(
    new TextEncoder().encode(`${input.secret}:${input.principal}`),
  );
  const bucket =
    Number.parseInt(hash.slice(0, 8), 16) %
    VERIFICATION_ADMISSION.clientBuckets;
  return consumeExactRateLimit({
    ...options,
    scope: "public-verification-client-v1",
    principal: String(bucket),
    limit: VERIFICATION_ADMISSION.clientLimit,
  });
}
export async function applyVerificationAdmission(
  request: Request,
  deps: { persistence: TracePersistence; authSecret: string; now: () => Date },
): Promise<Response | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Cloudflare supplies this header; never trust caller-selected forwarded keys.
    const principal = request.headers.get("cf-connecting-ip");
    if (
      !principal ||
      principal.length > 64 ||
      !/^[0-9a-fA-F:.]+$/u.test(principal) ||
      !/^[\x21-\x7e]{32,128}$/u.test(deps.authSecret)
    )
      return verificationAdmissionUnavailable();
    const consume = deps.persistence.consumeVerificationAdmission;
    if (!consume) return verificationAdmissionUnavailable();
    const nowEpochSeconds = Math.floor(deps.now().getTime() / 1000);
    if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0)
      return verificationAdmissionUnavailable();
    const result = await Promise.race([
      consume.call(deps.persistence, {
        principal,
        secret: deps.authSecret,
        nowEpochSeconds,
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Admission timeout")),
          VERIFICATION_ADMISSION.timeoutMs,
        );
      }),
    ]);
    if (
      typeof result?.allowed !== "boolean" ||
      !Number.isSafeInteger(result.retryAfterSeconds) ||
      result.retryAfterSeconds < 1 ||
      result.retryAfterSeconds > VERIFICATION_ADMISSION.windowSeconds
    )
      return verificationAdmissionUnavailable();
    return result.allowed
      ? null
      : denied(429, "verification_rate_limited", result.retryAfterSeconds);
  } catch {
    return verificationAdmissionUnavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

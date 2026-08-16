/**
 * Exact fixed-window admission for OAuth endpoints backed by the identity D1 database.
 * The edge Rate Limiting binding remains a fast approximate shield; this single-statement
 * counter supplies the deterministic rejection boundary required before clients can ship.
 */
import { sha256Hex } from "./crypto";
import type { D1Database } from "./persistence";

type RateLimitRow = {
  expires_at: number;
  request_count: number;
};

export type ExactRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function consumeExactRateLimit(options: {
  db: D1Database;
  limit: number;
  nowEpochSeconds: number;
  principal: string;
  scope: string;
  secret: string;
  windowSeconds: number;
}): Promise<ExactRateLimitResult> {
  const {
    db,
    limit,
    nowEpochSeconds,
    principal,
    scope,
    secret,
    windowSeconds,
  } = options;
  const keyHash = await sha256Hex(
    `slop-identity-rate:v1:${secret}:${scope}:${principal}`,
  );
  const nextExpiry = nowEpochSeconds + windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO identity_rate_limits (
        key_hash, request_count, window_started_at, expires_at
      ) VALUES (?, 1, ?, ?)
      ON CONFLICT(key_hash) DO UPDATE SET
        request_count = CASE
          WHEN identity_rate_limits.expires_at <= excluded.window_started_at THEN 1
          ELSE identity_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN identity_rate_limits.expires_at <= excluded.window_started_at
            THEN excluded.window_started_at
          ELSE identity_rate_limits.window_started_at
        END,
        expires_at = CASE
          WHEN identity_rate_limits.expires_at <= excluded.window_started_at
            THEN excluded.expires_at
          ELSE identity_rate_limits.expires_at
        END
      RETURNING request_count, expires_at`,
    )
    .bind(keyHash, nowEpochSeconds, nextExpiry)
    .first<RateLimitRow>();
  if (
    row === null ||
    !Number.isSafeInteger(row.request_count) ||
    row.request_count < 1 ||
    !Number.isSafeInteger(row.expires_at) ||
    row.expires_at <= nowEpochSeconds
  ) {
    throw new Error("Identity rate-limit counter returned an invalid result");
  }
  return {
    allowed: row.request_count <= limit,
    retryAfterSeconds: Math.max(1, row.expires_at - nowEpochSeconds),
  };
}

export async function deleteExpiredRateLimits(
  db: D1Database,
  nowEpochSeconds: number,
): Promise<void> {
  await db
    .prepare("DELETE FROM identity_rate_limits WHERE expires_at <= ?")
    .bind(nowEpochSeconds)
    .run();
}

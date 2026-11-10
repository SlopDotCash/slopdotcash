import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { bytesToHex } from "../../src/lib/byte-encoding";
import type { NotificationsDependencies } from "./handler";

export type MailService = { fetch(request: Request): Promise<Response> };
type EnrolledDestination = {
  email: string;
  destinationVersion: string;
  verifiedAt: string;
};
export const EMAIL_TOKEN = /^[a-f0-9]{64}$/u;

export function randomEmailToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function enrolledDestination(
  db: NotificationsDependencies["db"],
  githubId: string,
): Promise<EnrolledDestination | null> {
  const row = await db
    .prepare(
      "SELECT email,destination_version,verified_at FROM notification_email_destinations WHERE github_id=?",
    )
    .bind(githubId)
    .first<{
      email: string;
      destination_version: string;
      verified_at: string;
    }>();
  return row
    ? {
        email: row.email,
        destinationVersion: row.destination_version,
        verifiedAt: row.verified_at,
      }
    : null;
}

export async function mailServiceRequest(
  service: MailService | undefined,
  path: string,
  body: object,
): Promise<Response | null> {
  if (!service) return null;
  try {
    return await service.fetch(
      new Request(`https://notify.internal/v1/email/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }),
    );
  } catch {
    return null;
  }
}

export async function generalEmailAvailable(
  service: MailService | undefined,
): Promise<boolean> {
  const response = await mailServiceRequest(service, "capabilities", {});
  if (!response?.ok) return false;
  try {
    return (
      ((await response.json()) as { enrollmentAvailable?: unknown })
        .enrollmentAvailable === true
    );
  } catch {
    return false;
  }
}

function hexBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

export function validUnsubscribeKey(key: string | undefined): key is string {
  return typeof key === "string" && /^[a-f0-9]{64}$/u.test(key);
}

/** An issued unsubscribe capability lives 30 days from its latest issue.
 * A fresh mail re-issues (renews) the same deterministic token, so the
 * window is bounded after mail stops, never permanent. */
export const EMAIL_UNSUBSCRIBE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function unsubscribeMac(
  key: string,
  version: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    hexBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`slop-email-unsubscribe-v1:${version}`),
  );
}

export async function emailUnsubscribeToken(
  key: string,
  version: string,
): Promise<string> {
  const mac = new Uint8Array(await unsubscribeMac(key, version));
  return `${version}.${bytesToHex(mac)}`;
}

export async function issueEmailUnsubscribeToken(
  db: NotificationsDependencies["db"],
  key: string,
  version: string,
  now: Date,
): Promise<string> {
  const token = await emailUnsubscribeToken(key, version);
  // Re-issuing the same deterministic token renews it: a fresh mail extends
  // its expiry and clears a previous spend, so the next unsubscribe from a
  // current mail works while a stale capability stays dead.
  await db
    .prepare(
      "INSERT INTO notification_email_unsubscribe_tokens(token_hash,destination_version,issued_at,expires_at,consumed_at) VALUES(?,?,?,?,NULL) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,consumed_at=NULL",
    )
    .bind(
      await verificationTokenHash(token),
      version,
      now.toISOString(),
      new Date(now.getTime() + EMAIL_UNSUBSCRIBE_TTL_MS).toISOString(),
    )
    .run();
  return token;
}

export async function verificationTokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

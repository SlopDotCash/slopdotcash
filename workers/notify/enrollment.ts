import {
  EMAIL_TOKEN,
  verificationTokenHash,
} from "../../backend/notifications/email-destinations";
import type { NotificationsDependencies } from "../../backend/notifications/handler";
import { readBoundedJson } from "../../src/lib/browser-json";
import { EMAIL_ADDRESS } from "./contracts";
import { inboxNoticeMime } from "./security";

export type EnrollmentMailDependencies = {
  db: NotificationsDependencies["db"];
  now(): Date;
  fromAddress: string;
  inboxUrl: string;
  unsubscribeKey: string;
  sendEmail(from: string, to: string, mime: string): Promise<void>;
};

/** Native Worker and isolated local development share this private protocol. */
export async function handleEnrollmentMailRequest(
  request: Request,
  deps: EnrollmentMailDependencies | null,
  unsubscribeDeps: Pick<EnrollmentMailDependencies, "db" | "now"> | null = deps,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.origin !== "https://notify.internal" ||
    url.search ||
    ![
      "/v1/email/capabilities",
      "/v1/email/verification",
      "/v1/email/unsubscribe",
    ].includes(url.pathname)
  )
    return null;
  const respond = (status: number, body?: object) =>
    new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json",
      },
    });
  if (request.method !== "POST") return respond(405);
  if (url.pathname.endsWith("/capabilities"))
    return respond(200, { enrollmentAvailable: deps !== null });
  if (!deps && !url.pathname.endsWith("/unsubscribe")) return respond(503);
  try {
    const body = await readBoundedJson(request, 2048, "private email request");
    if (!body || typeof body !== "object" || Array.isArray(body))
      return respond(400);
    const value = body as Record<string, unknown>;
    if (url.pathname.endsWith("/verification"))
      return respond(
        deps && (await sendEmailVerification(deps, value)) ? 204 : 409,
      );
    if (
      Object.keys(value).join() !== "token" ||
      typeof value.token !== "string"
    )
      return respond(400);
    if (!unsubscribeDeps) return respond(503);
    return respond(
      (await unsubscribeEmail(unsubscribeDeps, value.token)) ? 204 : 409,
    );
  } catch {
    return respond(500);
  }
}

/** Only the private service route can ask for a send, and the persisted
 * challenge binds its actor, address, consent, expiry and token hash. */
export async function sendEmailVerification(
  deps: EnrollmentMailDependencies,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (
    Object.keys(body).sort().join() !== "githubId,id,token" ||
    typeof body.githubId !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(body.githubId) ||
    typeof body.id !== "string" ||
    !EMAIL_TOKEN.test(body.id) ||
    typeof body.token !== "string" ||
    !EMAIL_TOKEN.test(body.token)
  )
    return false;
  const now = deps.now().toISOString();
  const row = await deps.db
    .prepare(
      "SELECT email,state,expires_at FROM notification_email_verifications WHERE id=? AND github_id=? AND token_hash=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>?",
    )
    .bind(body.id, body.githubId, await verificationTokenHash(body.token), now)
    .first<{ email: string; state: string; expires_at: string }>();
  if (!row || !EMAIL_ADDRESS.test(row.email)) return false;
  if (row.state !== "queued") return true;
  const claim = await deps.db
    .prepare(
      "UPDATE notification_email_verifications SET state='sending' WHERE id=? AND state='queued' AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>?",
    )
    .bind(body.id, now)
    .run();
  if (claim.meta?.changes !== 1) return true;
  const url = new URL(deps.inboxUrl);
  url.hash = `verify-email=${body.token}`;
  let state = "sent";
  try {
    await deps.sendEmail(
      deps.fromAddress,
      row.email,
      inboxNoticeMime({
        from: deps.fromAddress,
        to: row.email,
        subject: "Verify your Slop email",
        date: deps.now(),
        deliveryId: body.id,
        attempt: 1,
        text: `You requested email notifications for your Slop account.\n\nOpen this link, sign in to the same account, and choose Verify email:\n${url.toString()}\n\nThis link expires in 30 minutes and works once. If you did not request it, ignore this email.\n`,
      }),
    );
  } catch {
    state = "unknown";
  }
  await deps.db
    .prepare(
      "UPDATE notification_email_verifications SET state=? WHERE id=? AND state='sending'",
    )
    .bind(state, body.id)
    .run();
  return true;
}

/** This capability only disables this exact verified destination's consent. */
export async function unsubscribeEmail(
  deps: Pick<EnrollmentMailDependencies, "db" | "now">,
  token: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/u.test(token)) return false;
  const issued = await deps.db
    .prepare(
      "SELECT destination_version FROM notification_email_unsubscribe_tokens WHERE token_hash=?",
    )
    .bind(await verificationTokenHash(token))
    .first<{ destination_version: string }>();
  if (!issued) return false;
  const version = issued.destination_version;
  const result = await deps.db
    .prepare(`UPDATE notification_email_preferences SET enabled=0,security_enabled=0,updated_at=?
    WHERE destination_version=? AND EXISTS(SELECT 1 FROM notification_email_destinations d WHERE d.github_id=notification_email_preferences.github_id AND d.destination_version=?)`)
    .bind(deps.now().toISOString(), version, version)
    .run();
  // D1 counts the queued-notice suppression triggers in this write as well.
  return (result.meta?.changes ?? 0) > 0;
}

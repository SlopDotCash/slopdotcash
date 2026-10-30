/** NOT-01: a session owner may opt in only to their currently verified destination. */
import { readBoundedBytes, readBoundedJson } from "../../src/lib/browser-json";
import { EMAIL_ADDRESS } from "../../workers/notify/contracts";
import type { D1QueryStatement, D1TransactionalDatabase } from "../d1";
import {
  apiErrorResponse,
  fail,
  isSameOriginJsonWrite,
  json,
  requireActor,
} from "../http";
import {
  EMAIL_TOKEN,
  enrolledDestination,
  generalEmailAvailable,
  type MailService,
  mailServiceRequest,
  randomEmailToken,
  verificationTokenHash,
} from "./email-destinations";
import type { NotificationsDependencies } from "./handler";

export type EmailEligibility =
  | { available: false }
  | { available: true; email: string; destinationVersion: string };
export type EmailPreferencesDependencies = NotificationsDependencies & {
  eligibility(githubId: string): Promise<EmailEligibility | null>;
  mailService?: MailService;
};
const PATH = "/api/v1/notifications/email";
function emailBatch(
  deps: EmailPreferencesDependencies,
  statements: D1QueryStatement[],
) {
  const db = deps.db as EmailPreferencesDependencies["db"] &
    Partial<Pick<D1TransactionalDatabase<D1QueryStatement>, "batch">>;
  if (!db.batch)
    fail(503, "email_unavailable", "Email storage is unavailable.");
  return db.batch(statements);
}
export async function handleEmailPreferences(
  request: Request,
  deps: EmailPreferencesDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== PATH &&
    !["verification", "verify", "unsubscribe"].some(
      (action) => url.pathname === `${PATH}/${action}`,
    )
  )
    return null;
  if (!["GET", "POST"].includes(request.method))
    return json(405, { error: "method_not_allowed" });
  const oneClick =
    url.pathname === `${PATH}/unsubscribe` && url.searchParams.has("token");
  if (request.method === "POST" && !oneClick && !isSameOriginJsonWrite(request))
    return json(403, { error: "origin_forbidden" });
  try {
    if (url.pathname === `${PATH}/unsubscribe`) {
      if (request.method !== "POST")
        return json(405, { error: "method_not_allowed" });
      const body = oneClick
        ? await oneClickBody(request, url)
        : await emailBody(request);
      if (
        Object.keys(body).join() !== "token" ||
        typeof body.token !== "string" ||
        !/^[a-f0-9]{64}\.[a-f0-9]{64}$/u.test(body.token)
      )
        return json(400, { error: "invalid_request" });
      const result = await mailServiceRequest(
        deps.mailService,
        "unsubscribe",
        body,
      );
      return result?.ok
        ? json(200, { enabled: false, securityEnabled: false })
        : json(result?.status === 409 ? 409 : 503, {
            error:
              result?.status === 409
                ? "unsubscribe_invalid"
                : "email_unavailable",
          });
    }
    // The email preference is a notification action: like the inbox handler,
    // bind it to the account the client rendered. A client that omits the
    // header keeps the plain session check; a mismatched header refuses.
    const actor = await requireActor(request, deps);
    if (url.pathname !== PATH) {
      if (request.method !== "POST")
        return json(405, { error: "method_not_allowed" });
      return url.pathname.endsWith("/verification")
        ? requestEmailVerification(request, deps, actor.githubId)
        : verifyEmail(request, deps, actor.githubId);
    }
    return await handleEmailPreferenceForActor(request, deps, actor.githubId);
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "notifications API failure",
      respond: (status, { error }) =>
        json(status, {
          error: error === "unauthorized" ? "not_signed_in" : error,
        }),
    });
  }
}

async function oneClickBody(
  request: Request,
  url: URL,
): Promise<Record<string, unknown>> {
  if (
    url.searchParams.size !== 1 ||
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
  )
    fail(400, "invalid_request", "Invalid unsubscribe request.");
  const bytes = await readBoundedBytes(request, 128, "unsubscribe request");
  if (new TextDecoder().decode(bytes) !== "List-Unsubscribe=One-Click")
    fail(400, "invalid_request", "Invalid unsubscribe request.");
  return { token: url.searchParams.get("token") };
}

async function handleEmailPreferenceForActor(
  request: Request,
  deps: EmailPreferencesDependencies,
  githubId: string,
): Promise<Response> {
  if (request.method === "GET") {
    return emailPreferenceView(deps, githubId);
  }
  const body = await emailBody(request);
  const securityPresent = body.securityEnabled !== undefined;
  const enabled = body.enabled === true || body.securityEnabled === true;
  const suppliedVersion = body.destinationVersion !== undefined;
  const keys = Object.keys(body).sort().join();
  const expectedKeys = [
    "enabled",
    ...(securityPresent ? ["securityEnabled"] : []),
    ...(suppliedVersion ? ["destinationVersion"] : []),
  ]
    .sort()
    .join();
  if (
    typeof body.enabled !== "boolean" ||
    (securityPresent && typeof body.securityEnabled !== "boolean") ||
    (suppliedVersion &&
      (!enabled || typeof body.destinationVersion !== "string")) ||
    keys !== expectedKeys
  )
    return json(400, { error: "invalid_request" });
  const prior = await deps.db
    .prepare(
      "SELECT enabled,security_enabled,destination_version FROM notification_email_preferences WHERE github_id=?",
    )
    .bind(githubId)
    .first<{
      enabled: number;
      security_enabled: number | null;
      destination_version: string | null;
    }>();
  const withdraws =
    (prior?.enabled === 1 && body.enabled === false) ||
    (prior?.security_enabled === 1 && body.securityEnabled === false);
  const requiresVerification =
    (body.enabled === true && prior?.enabled !== 1) ||
    (body.securityEnabled === true && prior?.security_enabled !== 1) ||
    (suppliedVersion &&
      (!withdraws || body.destinationVersion !== prior?.destination_version));
  let version = "";
  if (requiresVerification) {
    if (!suppliedVersion) return json(409, { error: "verification_changed" });
    const destination =
      (await enrolledDestination(deps.db, githubId)) ??
      (await deps.eligibility(githubId));
    if (destination === null) return json(503, { error: "email_unavailable" });
    if (
      ("available" in destination && !destination.available) ||
      body.destinationVersion !==
        ("destinationVersion" in destination
          ? destination.destinationVersion
          : null)
    )
      return json(409, { error: "verification_changed" });
    version = body.destinationVersion as string;
  }
  if (enabled && !requiresVerification && prior) {
    const result = await deps.db
      .prepare(
        "UPDATE notification_email_preferences SET enabled=?,security_enabled=COALESCE(?,security_enabled),updated_at=? WHERE github_id=? AND enabled=? AND security_enabled IS ? AND destination_version IS ?",
      )
      .bind(
        body.enabled ? 1 : 0,
        securityPresent ? (body.securityEnabled ? 1 : 0) : null,
        deps.now().toISOString(),
        githubId,
        prior.enabled,
        prior.security_enabled,
        prior.destination_version,
      )
      .run();
    if ((result.meta?.changes ?? 0) === 0)
      return json(409, { error: "preference_changed" });
    return json(200, {
      enabled: body.enabled,
      ...(securityPresent ? { securityEnabled: body.securityEnabled } : {}),
    });
  }
  await deps.db
    .prepare(`INSERT INTO notification_email_preferences(github_id,enabled,destination_version,updated_at,security_enabled) VALUES (?,?,?,?,?)
    ON CONFLICT(github_id) DO UPDATE SET enabled=excluded.enabled,
      destination_version=CASE WHEN excluded.destination_version='' THEN notification_email_preferences.destination_version ELSE excluded.destination_version END,
      security_enabled=COALESCE(excluded.security_enabled,notification_email_preferences.security_enabled),updated_at=excluded.updated_at`)
    .bind(
      githubId,
      body.enabled ? 1 : 0,
      version,
      deps.now().toISOString(),
      securityPresent ? (body.securityEnabled ? 1 : 0) : null,
    )
    .run();
  return json(200, {
    enabled: body.enabled,
    ...(securityPresent ? { securityEnabled: body.securityEnabled } : {}),
  });
}

async function emailPreferenceView(
  deps: EmailPreferencesDependencies,
  githubId: string,
  status = 200,
): Promise<Response> {
  const enrollmentAvailability = generalEmailAvailable(deps.mailService);
  const rows = await deps.db
    .prepare(
      "SELECT enabled,security_enabled,destination_version FROM notification_email_preferences WHERE github_id=?",
    )
    .bind(githubId)
    .all<{
      enabled: number;
      security_enabled: number | null;
      destination_version: string | null;
    }>();
  const saved = rows.results[0];
  let destination: EmailEligibility | null;
  try {
    const registered = await enrolledDestination(deps.db, githubId);
    destination = registered
      ? { available: true, ...registered }
      : await deps.eligibility(githubId);
  } catch {
    destination = null;
  }
  const enabled =
    saved?.enabled === 1 &&
    (!destination?.available ||
      saved.destination_version === destination.destinationVersion);
  const pending = await deps.db
    .prepare(
      "SELECT email,expires_at,state FROM notification_email_verifications WHERE github_id=? AND consumed_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1",
    )
    .bind(githubId)
    .first<{ email: string; expires_at: string; state: string }>();
  return json(status, {
    enabled,
    securityEnabled:
      saved?.security_enabled === 1 &&
      (!destination?.available ||
        saved.destination_version === destination.destinationVersion),
    enrollmentAvailable: await enrollmentAvailability,
    pending: pending
      ? {
          email: pending.email,
          expiresAt: pending.expires_at,
          state:
            Date.parse(pending.expires_at) <= deps.now().getTime()
              ? "expired"
              : pending.state,
        }
      : null,
    availability:
      destination === null
        ? "unavailable"
        : destination.available
          ? "verified"
          : "unverified",
    ...(destination?.available
      ? {
          email: destination.email,
          destinationVersion: destination.destinationVersion,
        }
      : {}),
  });
}

async function emailBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await readBoundedJson(request, 2048, "email preference");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid_request");
    return value as Record<string, unknown>;
  } catch {
    fail(400, "invalid_request", "Provide a valid email request.");
  }
}

async function requestEmailVerification(
  request: Request,
  deps: EmailPreferencesDependencies,
  githubId: string,
): Promise<Response> {
  const body = await emailBody(request);
  if (
    Object.keys(body).sort().join() !==
      "email,enabled,idempotencyKey,securityEnabled" ||
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !EMAIL_ADDRESS.test(body.email.trim()) ||
    typeof body.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(body.idempotencyKey) ||
    typeof body.enabled !== "boolean" ||
    typeof body.securityEnabled !== "boolean"
  )
    return json(400, { error: "invalid_request" });
  if (!(await generalEmailAvailable(deps.mailService)))
    return json(503, { error: "email_unavailable" });
  const email = body.email.trim();
  const existing = await deps.db
    .prepare(
      "SELECT email,activity_enabled,security_enabled FROM notification_email_verifications WHERE github_id=? AND request_key=?",
    )
    .bind(githubId, body.idempotencyKey)
    .first<{
      email: string;
      activity_enabled: number;
      security_enabled: number;
    }>();
  if (existing) {
    if (
      existing.email !== email ||
      existing.activity_enabled !== Number(body.enabled) ||
      existing.security_enabled !== Number(body.securityEnabled)
    )
      return json(409, { error: "idempotency_conflict" });
    return emailPreferenceView(deps, githubId, 202);
  }
  const token = randomEmailToken();
  const id = randomEmailToken();
  const now = deps.now();
  const at = now.toISOString();
  const addressKey = await verificationTokenHash(email.toLowerCase());
  const results = await emailBatch(deps, [
    deps.db
      .prepare(`INSERT INTO notification_email_verifications(id,github_id,request_key,email,address_key,token_hash,activity_enabled,security_enabled,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM notification_email_verifications WHERE github_id=? AND created_at>?)
      AND (SELECT count(*) FROM notification_email_verifications WHERE (github_id=? OR address_key=?) AND created_at>?)<3
      ON CONFLICT(github_id,request_key) DO NOTHING`)
      .bind(
        id,
        githubId,
        body.idempotencyKey,
        email,
        addressKey,
        await verificationTokenHash(token),
        Number(body.enabled),
        Number(body.securityEnabled),
        at,
        new Date(now.getTime() + 30 * 60_000).toISOString(),
        githubId,
        new Date(now.getTime() - 60_000).toISOString(),
        githubId,
        addressKey,
        new Date(now.getTime() - 60 * 60_000).toISOString(),
      ),
    deps.db
      .prepare(
        "UPDATE notification_email_verifications SET cancelled_at=? WHERE github_id=? AND id<>? AND consumed_at IS NULL AND cancelled_at IS NULL AND EXISTS(SELECT 1 FROM notification_email_verifications WHERE id=?)",
      )
      .bind(at, githubId, id, id),
  ]);
  if (results[0].meta?.changes !== 1) {
    const replay = await deps.db
      .prepare(
        "SELECT email,activity_enabled,security_enabled FROM notification_email_verifications WHERE github_id=? AND request_key=?",
      )
      .bind(githubId, body.idempotencyKey)
      .first<{
        email: string;
        activity_enabled: number;
        security_enabled: number;
      }>();
    if (
      replay?.email === email &&
      replay.activity_enabled === Number(body.enabled) &&
      replay.security_enabled === Number(body.securityEnabled)
    )
      return emailPreferenceView(deps, githubId, 202);
    const recent = (
      await deps.db
        .prepare(
          "SELECT github_id,created_at FROM notification_email_verifications WHERE (github_id=? OR address_key=?) AND created_at>? ORDER BY created_at DESC",
        )
        .bind(
          githubId,
          addressKey,
          new Date(now.getTime() - 3_600_000).toISOString(),
        )
        .all<{ github_id: string; created_at: string }>()
    ).results;
    const actorLast = recent.find((row) => row.github_id === githubId);
    const retryAt = Math.max(
      now.getTime() + 1000,
      actorLast ? Date.parse(actorLast.created_at) + 60_000 : 0,
      recent.length >= 3 ? Date.parse(recent[2].created_at) + 3_600_000 : 0,
    );
    return json(429, {
      error: "verification_rate_limited",
      retryAfter: Math.ceil((retryAt - now.getTime()) / 1000),
    });
  }
  const sent = await mailServiceRequest(deps.mailService, "verification", {
    githubId,
    id,
    token,
  });
  if (!sent?.ok)
    await deps.db
      .prepare(
        "UPDATE notification_email_verifications SET state='unknown' WHERE id=? AND state='queued'",
      )
      .bind(id)
      .run();
  return emailPreferenceView(deps, githubId, 202);
}

async function verifyEmail(
  request: Request,
  deps: EmailPreferencesDependencies,
  githubId: string,
): Promise<Response> {
  const body = await emailBody(request);
  if (
    Object.keys(body).join() !== "token" ||
    typeof body.token !== "string" ||
    !EMAIL_TOKEN.test(body.token)
  )
    return json(400, { error: "invalid_request" });
  const version = randomEmailToken();
  const at = deps.now().toISOString();
  const result = await emailBatch(deps, [
    deps.db
      .prepare(
        "UPDATE notification_email_verifications SET consumed_at=?,destination_version=? WHERE token_hash=? AND github_id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>?",
      )
      .bind(at, version, await verificationTokenHash(body.token), githubId, at),
    deps.db
      .prepare(`INSERT INTO notification_email_destinations(github_id,email,destination_version,verified_at)
      SELECT github_id,email,destination_version,consumed_at FROM notification_email_verifications WHERE github_id=? AND destination_version=?
      ON CONFLICT(github_id) DO UPDATE SET email=excluded.email,destination_version=excluded.destination_version,verified_at=excluded.verified_at`)
      .bind(githubId, version),
    deps.db
      .prepare(`INSERT INTO notification_email_preferences(github_id,enabled,security_enabled,destination_version,updated_at)
      SELECT github_id,activity_enabled,security_enabled,destination_version,consumed_at FROM notification_email_verifications WHERE github_id=? AND destination_version=?
      ON CONFLICT(github_id) DO UPDATE SET enabled=excluded.enabled,security_enabled=excluded.security_enabled,destination_version=excluded.destination_version,updated_at=excluded.updated_at`)
      .bind(githubId, version),
  ]);
  if (result[0].meta?.changes !== 1)
    return json(409, { error: "verification_invalid" });
  return emailPreferenceView(deps, githubId);
}

/** Only the server's session actor reaches this private service request. */
export async function verifiedEmailEligibility(
  service: { fetch(request: Request): Promise<Response> } | undefined,
  githubId: string,
): Promise<EmailEligibility | null> {
  if (!service) return null;
  const response = await service.fetch(
    new Request(
      "https://notify.internal/v1/activity-notifications/eligibility",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ githubId }),
        signal: AbortSignal.timeout(10_000),
      },
    ),
  );
  if (!response.ok) return null;
  const body = (await readBoundedJson(
    response,
    2048,
    "verified mail destination",
  )) as Record<string, unknown>;
  if (body.available === false) return { available: false };
  if (
    body.available !== true ||
    typeof body.email !== "string" ||
    typeof body.destinationVersion !== "string" ||
    !/^[a-f0-9]{64}$/u.test(body.destinationVersion)
  )
    return null;
  return {
    available: true,
    email: body.email,
    destinationVersion: body.destinationVersion,
  };
}

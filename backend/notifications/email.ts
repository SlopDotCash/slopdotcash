/** NOT-01: a session owner may opt in only to their currently verified destination. */
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  apiErrorResponse,
  isSameOriginJsonWrite,
  json,
  requireActor,
} from "../http";
import type { NotificationsDependencies } from "./handler";

export type EmailEligibility =
  | { available: false }
  | { available: true; email: string; destinationVersion: string };
export type EmailPreferencesDependencies = NotificationsDependencies & {
  eligibility(githubId: string): Promise<EmailEligibility | null>;
};
const PATH = "/api/v1/notifications/email";
export async function handleEmailPreferences(
  request: Request,
  deps: EmailPreferencesDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== PATH) return null;
  if (!["GET", "POST"].includes(request.method))
    return json(405, { error: "method_not_allowed" });
  if (request.method === "POST" && !isSameOriginJsonWrite(request))
    return json(403, { error: "origin_forbidden" });
  try {
    // The email preference is a notification action: like the inbox handler,
    // bind it to the account the client rendered. A client that omits the
    // header keeps the plain session check; a mismatched header refuses.
    const actor = await requireActor(request, deps);
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

async function handleEmailPreferenceForActor(
  request: Request,
  deps: EmailPreferencesDependencies,
  githubId: string,
): Promise<Response> {
  const actor = { githubId };
  if (request.method === "GET") {
    const rows = await deps.db
      .prepare(
        "SELECT enabled,destination_version FROM notification_email_preferences WHERE github_id=?",
      )
      .bind(actor.githubId)
      .all<{ enabled: number; destination_version: string | null }>();
    const saved = rows.results[0];
    let destination: EmailEligibility | null;
    try {
      destination = await deps.eligibility(actor.githubId);
    } catch {
      destination = null;
    }
    const enabled =
      saved?.enabled === 1 &&
      (!destination?.available ||
        saved.destination_version === destination.destinationVersion);
    return json(200, {
      enabled,
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
  let body: Record<string, unknown>;
  try {
    const value = await readBoundedJson(request, 2048, "email preference");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return json(400, { error: "invalid_request" });
    body = value as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_request" });
  }
  const keys = Object.keys(body).sort().join();
  if (
    typeof body.enabled !== "boolean" ||
    (body.enabled ? keys !== "destinationVersion,enabled" : keys !== "enabled")
  )
    return json(400, { error: "invalid_request" });
  let version = "";
  if (body.enabled) {
    let destination: EmailEligibility | null;
    try {
      destination = await deps.eligibility(actor.githubId);
    } catch {
      destination = null;
    }
    if (destination === null) return json(503, { error: "email_unavailable" });
    if (
      !destination.available ||
      body.destinationVersion !== destination.destinationVersion
    )
      return json(409, { error: "verification_changed" });
    version = destination.destinationVersion;
  }
  await deps.db
    .prepare(`INSERT INTO notification_email_preferences(github_id,enabled,destination_version,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(github_id) DO UPDATE SET enabled=excluded.enabled,destination_version=excluded.destination_version,updated_at=excluded.updated_at`)
    .bind(
      actor.githubId,
      body.enabled ? 1 : 0,
      version,
      deps.now().toISOString(),
    )
    .run();
  return json(200, { enabled: body.enabled });
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

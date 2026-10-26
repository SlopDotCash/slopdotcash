/**
 * Authenticated in-app inbox (PRD NOT-01). Rows are written only by the
 * statements in ./events.ts, in the same D1 batch as the source change; this
 * route lists the signed-in recipient's own rows and marks them read. It never
 * sends email and never reads another account's rows.
 */
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  type EmailDelivery,
  isNotificationEventKey,
  MAX_NOTIFICATION_MARK,
  type Notification,
  type NotificationsResponse,
  notificationCursor,
} from "../../src/lib/notifications";
import {
  SCAM_REVIEW_PATH,
  type ScamReviewTarget,
  scamReviewGitHubUrl,
  scamReviewPath,
} from "./events";

export interface NotificationsDependencies {
  db: {
    prepare(query: string): {
      bind(...values: (string | number)[]): {
        all<T>(): Promise<{ results: T[] }>;
        run(): Promise<{ meta?: { changes?: number } }>;
      };
    };
  };
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
  now(): Date;
  moderatorGithubIds?: ReadonlySet<string>;
}

export const NOTIFICATIONS_PATH = "/api/v1/notifications";
const NOTIFICATIONS_PATH_READ = `${NOTIFICATIONS_PATH}/read`;
const READ_PATH = NOTIFICATIONS_PATH_READ;
const LIST_LIMIT = 100;

/**
 * Moderator-only review notices must be backed by an escalated appeal or
 * moderator-review scam penalty whose appellant/author is not the recipient.
 */
const MODERATOR_NOTICE_ALLOWED = `(
  notifications.kind NOT IN ('slopbot_appeal_review', 'slopbot_scam_review')
  OR (
    ? = 1
    AND (
      (notifications.kind = 'slopbot_appeal_review' AND EXISTS (
        SELECT 1 FROM slopbot_appeals a
         WHERE 'slopbot-' || a.appeal_key = notifications.event_key
           AND a.escalated_at IS NOT NULL
           AND a.appellant_github_id <> notifications.recipient_github_id
      ))
      OR (notifications.kind = 'slopbot_scam_review' AND EXISTS (
        SELECT 1 FROM slopbot_penalties p
         WHERE 'slopbot-scam-review:' || p.item_node_id = notifications.event_key
           AND p.category = 'scam'
           AND p.moderator_review = 1
           AND p.author_github_id <> notifications.recipient_github_id
      ))
    )
  )
)`;

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

interface Row {
  event_key: string;
  kind: Notification["kind"];
  subject: string;
  detail: string | null;
  action_path: string;
  source_at: string;
  created_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  security_notice_id: string | null;
  delivery_state: string | null;
}

/**
 * Collapses one outbox state into what the recipient may see. No address,
 * destination digest, provider reference or case detail leaves the outbox.
 * A suppressed row (opt-out, revoked role or no destination) sent nothing and
 * reports nothing, so it cannot reveal why a private notice was withheld.
 */
function emailDelivery(state: string | null): EmailDelivery | null {
  switch (state) {
    case "queued":
    case "retrying":
    case "sending":
      return "queued";
    case "provider-accepted":
      return "sent";
    case "delivered":
      return "delivered";
    case "bounced":
    case "exhausted":
      return "failed";
    case "ambiguous":
      return "uncertain";
    default:
      return null;
  }
}

/** Returns null when the request is not for this route. */
export async function handleNotificationsApi(
  request: Request,
  deps: NotificationsDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  const appealPrefix = `${NOTIFICATIONS_PATH}/appeals/`;
  const appealRoute = url.pathname.startsWith(appealPrefix);
  const scamRoute = url.pathname.startsWith(SCAM_REVIEW_PATH);
  if (
    !appealRoute &&
    !scamRoute &&
    url.pathname !== NOTIFICATIONS_PATH &&
    url.pathname !== READ_PATH
  )
    return null;
  const write = url.pathname === READ_PATH;
  if (request.method !== (write ? "POST" : "GET"))
    return json(405, { error: "method_not_allowed" });
  // Writes ride the SameSite session cookie, so they must come from this
  // origin as JSON; a cross-site form can never submit one.
  if (
    write &&
    (request.headers.get("origin") !== url.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
  )
    return json(403, { error: "origin_forbidden" });
  try {
    const actor = await deps.sessionActor(request);
    if (actor === null) return json(401, { error: "not_signed_in" });
    const moderator = deps.moderatorGithubIds?.has(actor.githubId) === true;
    if (scamRoute) {
      // Moderator access is rechecked on every open (owner decision D4). The
      // target is only ever a path stored on the actor's own notice.
      if (!moderator) return json(403, { error: "not_authorized" });
      const target = scamReviewGitHubUrl(url.pathname);
      if (target === null) return json(404, { error: "not_found" });
      const rows = await deps.db
        .prepare(`SELECT 1 AS found FROM notifications n
        JOIN slopbot_penalties p
          ON n.event_key = 'slopbot-scam-review:' || p.item_node_id
        WHERE n.recipient_github_id = ? AND n.kind = 'slopbot_scam_review'
          AND n.action_path = ? AND p.category = 'scam'
          AND p.moderator_review = 1 AND p.author_github_id <> ?`)
        .bind(actor.githubId, url.pathname, actor.githubId)
        .all<{ found: number }>();
      if (!rows.results[0]) return json(404, { error: "not_found" });
      return new Response(null, {
        status: 302,
        headers: { ...headers, location: target },
      });
    }
    if (appealRoute) {
      if (!moderator) return json(403, { error: "not_authorized" });
      let key: string;
      try {
        key = decodeURIComponent(url.pathname.slice(appealPrefix.length));
      } catch {
        return json(400, { error: "invalid_request" });
      }
      const rows = await deps.db
        .prepare(`SELECT a.job_json FROM slopbot_appeals a
        JOIN notifications n ON n.event_key = 'slopbot-' || a.appeal_key
        WHERE a.appeal_key = ? AND a.escalated_at IS NOT NULL
          AND n.recipient_github_id = ? AND n.kind = 'slopbot_appeal_review'
          AND a.appellant_github_id <> ?`)
        .bind(key, actor.githubId, actor.githubId)
        .all<{ job_json: string }>();
      if (!rows.results[0]) return json(404, { error: "not_found" });
      const job = JSON.parse(rows.results[0].job_json) as ScamReviewTarget;
      const target = scamReviewGitHubUrl(scamReviewPath(job));
      if (target === null) throw new Error("Invalid stored appeal target");
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          location: target,
        },
      });
    }
    if (!write) {
      let cursor: [string, string] | null = null;
      const rawCursor = url.searchParams.get("cursor");
      if (rawCursor !== null) {
        try {
          cursor = notificationCursor(rawCursor);
        } catch {
          return json(400, { error: "invalid_cursor" });
        }
      }
      const [rows, unread] = await Promise.all([
        deps.db
          .prepare(
            `SELECT event_key,
                    CASE WHEN kind = 'slopbot_appeal_review' AND EXISTS (
                      SELECT 1 FROM slopbot_appeals a WHERE 'slopbot-' || a.appeal_key = notifications.event_key AND a.resolved_at IS NOT NULL
                    ) THEN 'slopbot_appeal_resolved' ELSE kind END AS kind,
                    subject, detail, action_path, source_at,
                    created_at, read_at,
                    (SELECT id FROM security_notification_outbox s
                      WHERE s.event_key = notifications.event_key AND s.recipient_github_id = notifications.recipient_github_id
                        AND s.template_version = 'security-inbox-v1') AS security_notice_id,
                    (SELECT acknowledged_at FROM security_notification_outbox s
                      WHERE s.event_key = notifications.event_key AND s.recipient_github_id = notifications.recipient_github_id
                        AND s.template_version = 'security-inbox-v1') AS acknowledged_at,
                    COALESCE(
                      (SELECT state FROM security_notification_outbox s
                        WHERE s.event_key = notifications.event_key AND s.recipient_github_id = notifications.recipient_github_id
                          AND s.template_version IN ('security-inbox-v1','security-receipt-v1')),
                      (SELECT state FROM activity_notification_outbox a
                        WHERE a.event_key = notifications.event_key AND a.recipient_github_id = notifications.recipient_github_id
                          AND a.template_version = 'activity-inbox-v1')) AS delivery_state
               FROM notifications WHERE recipient_github_id = ?
                AND ${MODERATOR_NOTICE_ALLOWED}
                ${cursor ? "AND (source_at < ? OR (source_at = ? AND event_key > ?))" : ""}
              ORDER BY source_at DESC, event_key LIMIT ?`,
          )
          .bind(
            actor.githubId,
            moderator ? 1 : 0,
            ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []),
            LIST_LIMIT + 1,
          )
          .all<Row>(),
        deps.db
          .prepare(
            `SELECT COUNT(*) AS count FROM notifications
              WHERE recipient_github_id = ? AND read_at IS NULL
                AND ${MODERATOR_NOTICE_ALLOWED}`,
          )
          .bind(actor.githubId, moderator ? 1 : 0)
          .all<{ count: number }>(),
      ]);
      const page = rows.results.slice(0, LIST_LIMIT);
      const last = page.at(-1);
      const body: NotificationsResponse = {
        nextCursor:
          rows.results.length > LIST_LIMIT && last
            ? JSON.stringify([last.source_at, last.event_key])
            : null,
        notifications: page.map((row) => {
          const delivery = emailDelivery(row.delivery_state);
          return {
            eventKey: row.event_key,
            kind: row.kind,
            subject: row.subject,
            detail: row.detail,
            actionPath: row.action_path,
            sourceAt: row.source_at,
            createdAt: row.created_at,
            readAt: row.read_at,
            ...(row.kind === "security_case" && row.security_notice_id !== null
              ? { acknowledgedAt: row.acknowledged_at }
              : {}),
            ...(delivery ? { emailDelivery: delivery } : {}),
          };
        }),
        unread: unread.results[0]?.count ?? 0,
      };
      return json(200, body);
    }
    let body: unknown;
    try {
      body = await readBoundedJson(
        request,
        32 * 1024,
        "notification read request",
      );
    } catch {
      return json(400, { error: "invalid_request" });
    }
    const keys = (body as { eventKeys?: unknown } | null)?.eventKeys;
    if (
      typeof body !== "object" ||
      body === null ||
      Object.keys(body).length !== 1 ||
      !Array.isArray(keys) ||
      keys.length < 1 ||
      keys.length > MAX_NOTIFICATION_MARK ||
      !keys.every(isNotificationEventKey) ||
      new Set(keys).size !== keys.length
    )
      return json(400, { error: "invalid_request" });
    const result = await deps.db
      .prepare(
        `UPDATE notifications SET read_at = ?
          WHERE recipient_github_id = ? AND read_at IS NULL
            AND ${MODERATOR_NOTICE_ALLOWED}
            AND event_key IN (${keys.map(() => "?").join(", ")})`,
      )
      .bind(
        deps.now().toISOString(),
        actor.githubId,
        moderator ? 1 : 0,
        ...keys,
      )
      .run();
    const marked = result.meta?.changes;
    if (typeof marked !== "number") throw new Error("D1 reported no changes");
    return json(200, { marked });
  } catch {
    console.error("notifications API failure");
    return json(500, { error: "internal_error" });
  }
}

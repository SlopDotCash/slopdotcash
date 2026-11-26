/**
 * A weekly reminder to the people who decide a project's private reports
 * (operator decision, 25 November 2026; PRD section 8).
 *
 * A report with no decision sat unseen for weeks when its reviewers never
 * opened the Inbox. Once a week, each reviewer of a project that has reports
 * waiting more than seven days gets one Inbox notice with the count and the
 * date of the oldest. It names no case, reporter or advisory, changes no
 * report, and is never sent for a report that waits for its deposit.
 *
 * The reviewers are the program's technical approvers. A project with no
 * security program has none, so its notice goes to the audience of its other
 * owner notices: the user steward, or an Organization steward's lister.
 *
 * The notice reuses the `project_revision` kind with an event key under
 * `security-queue:`, as the backlog rule does; the key carries the ISO week,
 * so a repeat inside the week writes nothing.
 */
import type { D1Database, D1QueryStatement } from "../d1";
import { PAYOUT_EXCEPTION_RECIPIENTS } from "../notifications/events";
import { readSecurityQueue } from "./operator-queue";

type Database = D1Database<D1QueryStatement>;

/** A report counts once it has waited longer than this. */
export const REMINDER_AFTER_DAYS = 7;
export const OWNER_REMINDER_PREFIX = "security-queue:";

/** The ISO 8601 week of a UTC instant, as `2026-W48`. */
function isoWeek(now: Date): string {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Thursday of this week decides the ISO year.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function ownerReminderKey(projectId: string, now: Date): string {
  return `${OWNER_REMINDER_PREFIX}${projectId}:${isoWeek(now)}`;
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function ownerReminderDetail(waiting: number, oldestAt: string): string {
  return waiting === 1
    ? `1 private report has waited more than ${REMINDER_AFTER_DAYS} days for a decision. It was received on ${longDate(oldestAt)}.`
    : `${waiting} private reports have waited more than ${REMINDER_AFTER_DAYS} days for a decision. The oldest was received on ${longDate(oldestAt)}.`;
}

const GITHUB_ID = (column: string) =>
  `typeof(${column}) = 'text' AND length(${column}) BETWEEN 1 AND 20
   AND ${column} GLOB '[1-9]*' AND ${column} NOT GLOB '*[^0-9]*'`;

/**
 * One notice per reviewer. The first branch serves a project with a program;
 * the second only a project without one.
 */
const INSERT_REMINDER = `INSERT INTO notifications (
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at
)
SELECT ?1, audience.recipient, 'project_revision', ?2, ?3, '/inbox', ?4, ?4
  FROM (
    SELECT json_extract(a.value, '$.githubId') AS recipient
      FROM projects p,
           json_each(p.manifest, '$.securityBounty.approvers.technical') a
     WHERE p.id = ?2
    UNION
    SELECT recipient
      FROM projects p
      JOIN ${PAYOUT_EXCEPTION_RECIPIENTS("?2")}
     WHERE p.id = ?2
       AND json_type(p.manifest, '$.securityBounty.approvers.technical') IS NULL
  ) audience
 WHERE ${GITHUB_ID("audience.recipient")}
   AND substr(?1, 1, length('${OWNER_REMINDER_PREFIX}' || ?2 || ':')) = '${OWNER_REMINDER_PREFIX}' || ?2 || ':'
ON CONFLICT (event_key, recipient_github_id) DO NOTHING`;

/**
 * Writes this week's reminders. Never throws: a reminder that cannot be
 * written is counted and logged, and the caller's own work goes on.
 */
export async function sendOwnerReminders(
  db: Database,
  now: Date,
): Promise<{ projects: number; failed: number }> {
  let queue: Awaited<ReturnType<typeof readSecurityQueue>>;
  try {
    queue = await readSecurityQueue(db, now);
  } catch {
    console.error("security owner reminders: queue unavailable");
    return { projects: 0, failed: 0 };
  }
  const at = now.toISOString();
  let projects = 0;
  let failed = 0;
  for (const entry of queue) {
    if (entry.undecidedOver7Days < 1) continue;
    projects += 1;
    try {
      await db
        .prepare(INSERT_REMINDER)
        .bind(
          ownerReminderKey(entry.projectId, now),
          entry.projectId,
          ownerReminderDetail(entry.undecidedOver7Days, entry.oldestOpenAt),
          at,
        )
        .run();
    } catch {
      failed += 1;
    }
  }
  if (failed > 0)
    console.error(`security owner reminders: ${failed} could not be written`);
  return { projects, failed };
}

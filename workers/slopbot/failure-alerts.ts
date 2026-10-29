import {
  SLOPBOT_FAILURE_NOTICE_PATH,
  type SlopbotFailureNotice,
  safeProviderFailure,
  validFailureNotice,
} from "../notify/contracts";
import type { D1Database } from "./persistence";

/** The cost ledger queues each new failed call. Claim before sending so a lost
 * response or overlapping cron cannot send the same failure notice twice.
 * No provider exception text, prompt, response or request identifier is sent.
 */
export async function dispatchFailureAlert(
  db: D1Database,
  notify: { fetch(request: Request): Promise<Response> },
) {
  const row = await db
    .prepare(`
    SELECT c.id AS callId,c.requested_model AS model,c.created_at AS occurredAt,c.failure,
      CASE WHEN c.failure='provider budget exhausted' THEN 'budget-exhausted'
        ELSE 'request-failed' END AS kind
    FROM slopbot_provider_failure_notices n JOIN slopbot_costs c ON c.id=n.call_id
    WHERE n.claimed_at IS NULL ORDER BY n.call_id LIMIT 1
  `)
    .first<Omit<SlopbotFailureNotice, "failure"> & { failure: unknown }>();
  if (!row) return;
  const notice = { ...row, failure: safeProviderFailure(row.failure) };
  if (!validFailureNotice(notice))
    throw new Error("Invalid provider failure metadata");
  const claimed = await db
    .prepare(`UPDATE slopbot_provider_failure_notices
    SET claimed_at=? WHERE call_id=? AND claimed_at IS NULL RETURNING call_id`)
    .bind(new Date().toISOString(), notice.callId)
    .first();
  if (!claimed) return;
  const accepted = await deliverNotice(
    notify,
    SLOPBOT_FAILURE_NOTICE_PATH,
    notice,
    (outcome) =>
      db
        .prepare(
          `INSERT INTO slopbot_provider_failure_receipts(call_id,outcome,recorded_at) VALUES (?,?,?)`,
        )
        .bind(notice.callId, outcome, new Date().toISOString())
        .run(),
  );
  if (!accepted)
    throw new Error("Provider failure notice needs operator reconciliation");
}

/** Sends one claimed notice and records its outcome. Acceptance may precede a
 * transport error, so a failed send is ambiguous and is never resent blindly.
 */
export async function deliverNotice(
  notify: { fetch(request: Request): Promise<Response> },
  path: string,
  notice: unknown,
  record: (outcome: "accepted" | "ambiguous") => Promise<unknown>,
): Promise<boolean> {
  let outcome: "accepted" | "ambiguous" = "ambiguous";
  try {
    const response = await notify.fetch(
      new Request(`https://notify.internal${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(notice),
      }),
    );
    if (response.status === 202) outcome = "accepted";
  } catch {
    // Retain the durable claim for operator reconciliation.
  }
  await record(outcome);
  return outcome === "accepted";
}

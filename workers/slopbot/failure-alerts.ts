import {
  SLOPBOT_FAILURE_NOTICE_PATH,
  type SlopbotFailureNotice,
  safeProviderFailure,
  validFailureNotice,
} from "../notify/contracts";
import type { D1Database } from "./persistence";

// Operator decision, 17 November 2026. A route records all of its calls once
// it ends; waiting two minutes lets a later call of the same route land first.
const SETTLE_MS = 2 * 60 * 1000;
// One email per model and cause in this window; later ones are recorded only.
const REPEAT_MS = 6 * 60 * 60 * 1000;
// Suppressions are cheap; cap the work one scheduled run does.
const MAX_SUPPRESSIONS_PER_RUN = 200;

type Row = Omit<SlopbotFailureNotice, "failure"> & { failure: unknown };

/** The cost ledger queues each new failed call. Claim before sending so a lost
 * response or overlapping cron cannot send the same failure notice twice.
 * A failed call is not mailed when a later call in the same route served the
 * same job, or when the same model and cause was mailed in the last six hours;
 * such a notice is claimed with a suppression record instead. At most one
 * email is sent per run. No provider exception text, prompt, response or
 * request identifier is sent.
 */
export async function dispatchFailureAlert(
  db: D1Database,
  notify: { fetch(request: Request): Promise<Response> },
  now: () => Date = () => new Date(),
) {
  for (let i = 0; i <= MAX_SUPPRESSIONS_PER_RUN; i++) {
    const at = now();
    const settled = new Date(at.getTime() - SETTLE_MS).toISOString();
    const repeatSince = new Date(at.getTime() - REPEAT_MS).toISOString();
    const row = await db
      .prepare(`
    SELECT c.id AS callId,c.requested_model AS model,c.created_at AS occurredAt,c.failure,
      CASE WHEN c.failure='provider budget exhausted' THEN 'budget-exhausted'
        ELSE 'request-failed' END AS kind,
      CASE
        WHEN c.failure IS NOT 'provider budget exhausted' AND EXISTS (
          SELECT 1 FROM slopbot_costs o WHERE o.review_key=c.review_key
            AND o.call_kind=c.call_kind AND o.outcome='ok' AND o.id>c.id
            ) THEN 'served-by-fallback'
        WHEN EXISTS (
          SELECT 1 FROM slopbot_provider_failure_receipts r
            JOIN slopbot_costs p ON p.id=r.call_id
          WHERE r.outcome='accepted' AND r.recorded_at>=?
            AND p.requested_model=c.requested_model
            AND p.failure IS c.failure) THEN 'repeat-within-6h'
        ELSE NULL END AS suppress
    FROM slopbot_provider_failure_notices n JOIN slopbot_costs c ON c.id=n.call_id
    WHERE n.claimed_at IS NULL AND c.created_at<=?
    ORDER BY n.call_id LIMIT 1
  `)
      .bind(repeatSince, settled)
      .first<Row & { suppress: string | null }>();
    if (!row) return;
    const { suppress, ...rest } = row;
    const claimedAt = at.toISOString();
    const claimed = await db
      .prepare(`UPDATE slopbot_provider_failure_notices
    SET claimed_at=? WHERE call_id=? AND claimed_at IS NULL RETURNING call_id`)
      .bind(claimedAt, row.callId)
      .first();
    if (!claimed) continue;
    if (suppress !== null) {
      await db
        .prepare(
          `INSERT INTO slopbot_provider_failure_suppressions(call_id,reason,recorded_at) VALUES (?,?,?)`,
        )
        .bind(row.callId, suppress, claimedAt)
        .run();
      continue;
    }
    const notice = { ...rest, failure: safeProviderFailure(rest.failure) };
    if (!validFailureNotice(notice))
      throw new Error("Invalid provider failure metadata");
    const accepted = await deliverNotice(
      notify,
      SLOPBOT_FAILURE_NOTICE_PATH,
      notice,
      (outcome) =>
        db
          .prepare(
            `INSERT INTO slopbot_provider_failure_receipts(call_id,outcome,recorded_at) VALUES (?,?,?)`,
          )
          .bind(notice.callId, outcome, now().toISOString())
          .run(),
    );
    if (!accepted)
      throw new Error("Provider failure notice needs operator reconciliation");
    return;
  }
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

import {
  SLOPBOT_SPEND_INTERVAL_MICRO_USD,
  SLOPBOT_SPEND_NOTICE_PATH,
  validSpendNotice,
} from "../notify/contracts";
import { deliverNotice } from "./failure-alerts";
import type { D1Database } from "./persistence";

type NotifyBinding = { fetch(request: Request): Promise<Response> };

/** Claim one pending milestone per invocation, including past UTC months.
 * Provider amounts take precedence over estimates, including a reported zero.
 * The durable claim prevents overlapping cron deliveries. A crash or ambiguous
 * mail response needs operator reconciliation, never a blind automatic resend.
 */
export async function dispatchSpendAlert(
  db: D1Database,
  notify: NotifyBinding,
) {
  const row = await db
    .prepare(`
    WITH monthly AS (
      SELECT substr(created_at,1,7) AS month,
        SUM(COALESCE(provider_cost_micro_usd,cost_micro_usd)) AS recordedMicroUsd,
        SUM(CASE WHEN provider_cost_micro_usd IS NULL THEN 1 ELSE 0 END) AS estimatedCalls
      FROM slopbot_costs GROUP BY substr(created_at,1,7)
    ), pending AS (
      SELECT monthly.*,
        COALESCE((SELECT MAX(threshold_micro_usd) FROM slopbot_spend_alerts a WHERE a.month=monthly.month),0) + ? AS thresholdMicroUsd
      FROM monthly
    ) SELECT * FROM pending WHERE recordedMicroUsd >= thresholdMicroUsd ORDER BY month LIMIT 1
  `)
    .bind(SLOPBOT_SPEND_INTERVAL_MICRO_USD)
    .first<{
      month: string;
      recordedMicroUsd: number;
      estimatedCalls: number;
      thresholdMicroUsd: number;
    }>();
  if (!row) return;
  if (!validSpendNotice(row))
    throw new Error("Slopbot cost total requires reconciliation");
  const claimed = await db
    .prepare(`
    INSERT OR IGNORE INTO slopbot_spend_alerts
    (month,threshold_micro_usd,recorded_micro_usd,estimated_calls,claimed_at) VALUES (?,?,?,?,?)
    RETURNING month
  `)
    .bind(
      row.month,
      row.thresholdMicroUsd,
      row.recordedMicroUsd,
      row.estimatedCalls,
      new Date().toISOString(),
    )
    .first();
  if (!claimed) return;
  const accepted = await deliverNotice(
    notify,
    SLOPBOT_SPEND_NOTICE_PATH,
    row,
    (outcome) =>
      db
        .prepare(
          `INSERT INTO slopbot_spend_alert_receipts(month,threshold_micro_usd,outcome,recorded_at) VALUES (?,?,?,?)`,
        )
        .bind(
          row.month,
          row.thresholdMicroUsd,
          outcome,
          new Date().toISOString(),
        )
        .run(),
  );
  if (!accepted)
    throw new Error(
      "Slopbot cost alert delivery needs operator reconciliation",
    );
}

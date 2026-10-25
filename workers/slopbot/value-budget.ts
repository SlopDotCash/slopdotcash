import type { D1Database } from "./persistence";

const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const attempt = (value: string) => /^value:[a-f0-9-]{36}$/.test(value);

/** One atomic admission check across all installations. The caller supplies an
 * operator-approved allowance and, in capped mode, a conservative maximum.
 * A null monthly allowance means alerts only: record the attempt without
 * pretending to cap the provider's charge.
 * Per-attempt accounting and duplicate protection still apply.
 * A retry cannot reuse a reservation as permission for another provider call.
 */
export async function reserveValueBudget(
  db: D1Database,
  attemptId: string,
  maximumMicroUsd: number | null,
  approvedMonthlyMicroUsd: number | null,
  at = new Date(),
): Promise<boolean> {
  if (
    !attempt(attemptId) ||
    (maximumMicroUsd !== null && !positive(maximumMicroUsd)) ||
    (approvedMonthlyMicroUsd !== null &&
      (!positive(approvedMonthlyMicroUsd) || maximumMicroUsd === null)) ||
    !Number.isFinite(at.getTime())
  )
    throw new Error("Explicit valid value inference budget is required");
  if (
    approvedMonthlyMicroUsd !== null &&
    maximumMicroUsd !== null &&
    maximumMicroUsd > approvedMonthlyMicroUsd
  )
    return false;
  const stamp = at.toISOString();
  const row = await db
    .prepare(
      `WITH used AS (
         SELECT COALESCE(SUM(COALESCE(provider_cost_micro_usd,cost_micro_usd)),0) AS cost
         FROM slopbot_costs WHERE substr(created_at,1,7)=?1
       ), held AS (
         SELECT COALESCE(SUM(reserved_micro_usd),0) AS cost,
                COUNT(*)-COUNT(approved_limit_micro_usd) AS unknown
         FROM slopbot_value_budget_reservations r
         WHERE NOT EXISTS
           (SELECT 1 FROM slopbot_value_budget_reconciliations c WHERE c.attempt_id=r.attempt_id)
       ) INSERT INTO slopbot_value_budget_reservations
         (attempt_id,month,reserved_micro_usd,approved_limit_micro_usd,reserved_at)
       SELECT ?2,?1,?3,?4,?5 FROM used,held
       WHERE (?4 IS NULL OR (held.unknown=0 AND used.cost<=?4-?3 AND held.cost<=?4-?3-used.cost))
       AND NOT EXISTS(SELECT 1 FROM slopbot_value_budget_reservations WHERE attempt_id=?2)
       RETURNING attempt_id`,
    )
    .bind(
      stamp.slice(0, 7),
      attemptId,
      approvedMonthlyMicroUsd === null ? null : maximumMicroUsd,
      approvedMonthlyMicroUsd,
      stamp,
    )
    .first();
  return row !== null;
}

/** Reconcile only after every expected call has an immutable provider amount.
 * Estimates or missing receipts stay unknown. Capped attempts also need the
 * actual cost to fit their reserved capacity; alerts-only has no such limit.
 * The attempt ID must be the review_key used by recordCalls, which retains
 * failed calls too. This does not bill contributors or change spend alerts.
 */
export async function reconcileValueBudget(
  db: D1Database,
  attemptId: string,
  expectedCalls: number,
): Promise<boolean> {
  if (!attempt(attemptId) || !positive(expectedCalls))
    throw new Error("Invalid value budget reconciliation");
  const row = await db
    .prepare(
      `WITH costs AS (
         SELECT COUNT(*) AS n,COUNT(provider_cost_micro_usd) AS known,
                COALESCE(SUM(provider_cost_micro_usd),0) AS cost
         FROM slopbot_costs WHERE review_key=?1
       ) INSERT INTO slopbot_value_budget_reconciliations
         (attempt_id,call_count,recorded_micro_usd,reconciled_at)
       SELECT ?1,costs.n,costs.cost,?3 FROM costs
       JOIN slopbot_value_budget_reservations r ON r.attempt_id=?1
       WHERE costs.n=?2 AND costs.known=costs.n
       AND (r.approved_limit_micro_usd IS NULL OR costs.cost<=r.reserved_micro_usd)
       AND NOT EXISTS(SELECT 1 FROM slopbot_value_budget_reconciliations WHERE attempt_id=?1)
       RETURNING attempt_id`,
    )
    .bind(attemptId, expectedCalls, new Date().toISOString())
    .first();
  return row !== null;
}

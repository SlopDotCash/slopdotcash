import type { D1Statement } from "../../backend/d1";
import { PROVIDER_BUDGET_EXHAUSTED } from "./models";
import type { D1Database, D1TransactionalDatabase } from "./persistence";

const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const attempt = (value: string) => /^value:[a-f0-9-]{36}$/.test(value);

/** Internal SQL expressions only. Admission and reservation count identically. */
export function countedValueAttemptsSql(
  key: string,
  freeFailure: string,
): string {
  return `(SELECT COUNT(*) FROM slopbot_value_inference_attempts a
    JOIN slopbot_value_budget_reservations r ON r.attempt_id=a.attempt_id
    WHERE a.inference_key=${key}
      AND NOT EXISTS (SELECT 1 FROM slopbot_value_attempt_completions done
        JOIN slopbot_value_budget_reconciliations settled ON settled.attempt_id=done.attempt_id
        WHERE done.attempt_id=a.attempt_id AND settled.call_count=0 AND settled.recorded_micro_usd=0
          AND NOT EXISTS (SELECT 1 FROM slopbot_costs observed WHERE observed.review_key=a.attempt_id))
      AND (NOT EXISTS (SELECT 1 FROM slopbot_costs c
             WHERE c.review_key=a.attempt_id AND c.failure=${freeFailure})
        OR EXISTS (SELECT 1 FROM slopbot_costs c
             WHERE c.review_key=a.attempt_id AND c.failure IS NOT ${freeFailure})))`;
}

/** Completion closes result retention; a non-free cost alone does not. */
function nonFreeValueAttemptsSql(key: string, freeFailure: string): string {
  return `(SELECT COUNT(*) FROM slopbot_value_inference_attempts a
    JOIN slopbot_value_budget_reservations r ON r.attempt_id=a.attempt_id
    JOIN slopbot_value_attempt_completions done ON done.attempt_id=a.attempt_id
    WHERE a.inference_key=${key} AND EXISTS (
      SELECT 1 FROM slopbot_costs c WHERE c.review_key=a.attempt_id
        AND c.failure IS NOT ${freeFailure}))`;
}

function valueAttemptRefusalSql(
  key: string,
  freeFailure: string,
  limit: string,
) {
  return `CASE WHEN ${nonFreeValueAttemptsSql(key, freeFailure)} >= ${limit}
    THEN 'attempts' ELSE 'attempts-pending' END`;
}

type InferenceGuard = { key: string; limit: number };
type AttemptRefusal = "attempts" | "attempts-pending";
type ReservationResult = "reserved" | "budget" | AttemptRefusal;

/** Both the write and its refusal classification use one database snapshot. */
async function writeInferenceAttempt(
  db: D1Database,
  attemptId: string,
  statement: D1Statement,
  refusal: D1Statement,
): Promise<"written" | "budget" | AttemptRefusal> {
  const atomic = db as D1Database & Partial<D1TransactionalDatabase>;
  if (!atomic.batch)
    throw new Error("Transactional inference storage is required");
  const results = await atomic.batch([statement, refusal]);
  if (results.length !== 2 || results.some((result) => !result.success))
    throw new Error("Inference attempt result is unavailable");
  const inserted = results[0].results as { attempt_id?: unknown }[] | undefined;
  const decision = (results[1].results?.[0] as { result?: unknown } | undefined)
    ?.result;
  if (
    !Array.isArray(inserted) ||
    (decision !== "attempts" &&
      decision !== "attempts-pending" &&
      decision !== "budget")
  )
    throw new Error("Inference attempt result is unavailable");
  if (inserted.length === 1 && inserted[0].attempt_id === attemptId)
    return "written";
  if (inserted.length === 0) return decision;
  throw new Error("Inference attempt result is unavailable");
}

/** Unknown/incomplete reservations occupy the full cap, but are not proof that
 * every paid attempt is exhausted. A duplicate ID also admits no new call. */
export async function admitValueAttempt(
  db: D1Database,
  key: string,
  attemptId: string,
  limit: number,
): Promise<"admitted" | AttemptRefusal> {
  const result = await writeInferenceAttempt(
    db,
    attemptId,
    db
      .prepare(
        `INSERT INTO slopbot_value_inference_attempts (attempt_id,inference_key,started_at)
         SELECT ?1,?2,?3 WHERE ${countedValueAttemptsSql("?2", "?5")} < ?4
         AND NOT EXISTS (SELECT 1 FROM slopbot_value_inference_attempts WHERE attempt_id=?1)
         RETURNING attempt_id`,
      )
      .bind(
        attemptId,
        key,
        new Date().toISOString(),
        limit,
        PROVIDER_BUDGET_EXHAUSTED,
      ),
    db
      .prepare(`SELECT ${valueAttemptRefusalSql("?1", "?2", "?3")} AS result`)
      .bind(key, PROVIDER_BUDGET_EXHAUSTED, limit),
  );
  if (result === "written") return "admitted";
  if (result === "budget")
    throw new Error("Inference admission result is invalid");
  return result;
}

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
  return (
    (await reserveBudget(
      db,
      attemptId,
      maximumMicroUsd,
      approvedMonthlyMicroUsd,
      at,
      null,
    )) === "reserved"
  );
}

/** The inference path always supplies its immutable key and paid-attempt limit. */
export function reserveValueInferenceBudget(
  db: D1Database,
  attemptId: string,
  inferenceKey: string,
  attemptLimit: number,
  maximumMicroUsd: number | null,
  approvedMonthlyMicroUsd: number | null,
  at = new Date(),
): Promise<ReservationResult> {
  if (!/^[a-f0-9]{64}$/u.test(inferenceKey) || !positive(attemptLimit))
    throw new Error("Explicit inference key and attempt limit are required");
  return reserveBudget(
    db,
    attemptId,
    maximumMicroUsd,
    approvedMonthlyMicroUsd,
    at,
    { key: inferenceKey, limit: attemptLimit },
  );
}

async function reserveBudget(
  db: D1Database,
  attemptId: string,
  maximumMicroUsd: number | null,
  approvedMonthlyMicroUsd: number | null,
  at: Date,
  inference: InferenceGuard | null,
): Promise<ReservationResult> {
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
    return "budget";
  const stamp = at.toISOString();
  const inferenceClause = inference
    ? `AND EXISTS(SELECT 1 FROM slopbot_value_inference_attempts WHERE attempt_id=?2 AND inference_key=?6)
       AND ${countedValueAttemptsSql("?6", "?8")} < ?7`
    : "";
  const statement = db
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
       ${inferenceClause}
       RETURNING attempt_id`,
    )
    .bind(
      stamp.slice(0, 7),
      attemptId,
      approvedMonthlyMicroUsd === null ? null : maximumMicroUsd,
      approvedMonthlyMicroUsd,
      stamp,
      ...(inference
        ? [inference.key, inference.limit, PROVIDER_BUDGET_EXHAUSTED]
        : []),
    );
  if (inference) {
    const decision = await writeInferenceAttempt(
      db,
      attemptId,
      statement,
      db
        .prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM slopbot_value_inference_attempts WHERE attempt_id=?3 AND inference_key=?1)
            OR EXISTS(SELECT 1 FROM slopbot_value_budget_reservations WHERE attempt_id=?3)
            OR ${countedValueAttemptsSql("?1", "?2")} >= ?4
            THEN ${valueAttemptRefusalSql("?1", "?2", "?4")}
          ELSE 'budget' END AS result`)
        .bind(
          inference.key,
          PROVIDER_BUDGET_EXHAUSTED,
          attemptId,
          inference.limit,
        ),
    );
    return decision === "written" ? "reserved" : decision;
  }
  return (await statement.first()) !== null ? "reserved" : "budget";
}

/** Reconcile only after every expected call has an immutable provider amount.
 * An attempt that made no call reconciles with zero calls and zero cost.
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
  // Zero settles an attempt whose authority check refused before any call.
  if (
    !attempt(attemptId) ||
    !Number.isSafeInteger(expectedCalls) ||
    expectedCalls < 0
  )
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

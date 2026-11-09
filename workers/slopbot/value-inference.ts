import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type CallRecord,
  type ModelEnv,
  type Prompt,
  runStructuredRoute,
  TRIAGE_ROUTE,
} from "./models";
import { type D1Database, recordCalls } from "./persistence";
import {
  admitValueAttempt,
  reconcileValueBudget,
  reserveValueInferenceBudget,
} from "./value-budget";
import { valueProducerIdentity } from "./value-producer";

type RetainedValueInference<T> = {
  verdict: T;
  calls: CallRecord[];
  servedBy: CallRecord;
  blocked: false;
  inferredAt: string;
};

/** Private operational storage; contains validated proposals and usage metadata,
 * never prompts, source bodies or unvalidated provider responses.
 */
async function readValueInference<T>(
  db: D1Database,
  key: string,
  validate: (value: unknown) => T | null,
): Promise<RetainedValueInference<T> | null> {
  const row = await db
    .prepare(
      "SELECT attempt_id, result_json, result_digest FROM slopbot_value_inference_results WHERE inference_key = ?",
    )
    .bind(key)
    .first<{
      attempt_id: string;
      result_json: string;
      result_digest: string;
    }>();
  if (!row) return null;
  if ((await sha256Hex(row.result_json)) !== row.result_digest)
    throw new Error("Retained inference digest mismatch");
  const value = JSON.parse(row.result_json) as RetainedValueInference<T>;
  const verdict = validate(value.verdict);
  if (
    !verdict ||
    value.blocked !== false ||
    !Array.isArray(value.calls) ||
    !value.calls.some(
      (call) => JSON.stringify(call) === JSON.stringify(value.servedBy),
    )
  )
    throw new Error(
      "Retained inference does not validate against current source",
    );
  valueProducerIdentity(value.servedBy, value.inferredAt);
  await reconcileValueBudget(db, row.attempt_id, value.calls.length);
  return { ...value, verdict };
}

async function retainValueInference<T>(
  db: D1Database,
  key: string,
  attemptId: string,
  result: RetainedValueInference<T>,
) {
  const text = JSON.stringify(result);
  await db
    .prepare(`INSERT INTO slopbot_value_inference_results
    (inference_key, attempt_id, result_json, result_digest, recorded_at)
    SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS
      (SELECT 1 FROM slopbot_value_inference_results WHERE inference_key=?1)`)
    .bind(key, attemptId, text, await sha256Hex(text), result.inferredAt)
    .run();
}

/** This records that call persistence and any successful result retention
 * finished. It is independent of whether provider cost amounts are known. */
async function completeValueAttempt(
  db: D1Database,
  key: string,
  attemptId: string,
  expectedCalls: number,
  retained: boolean,
) {
  const row = await db
    .prepare(`INSERT INTO slopbot_value_attempt_completions (attempt_id,completed_at)
      SELECT a.attempt_id,?5 FROM slopbot_value_inference_attempts a
      JOIN slopbot_value_budget_reservations r ON r.attempt_id=a.attempt_id
      WHERE a.attempt_id=?1 AND a.inference_key=?2
        AND (SELECT COUNT(*) FROM slopbot_costs WHERE review_key=?1)=?3
        AND (?4=0 OR EXISTS (SELECT 1 FROM slopbot_value_inference_results WHERE inference_key=?2))
        AND NOT EXISTS (SELECT 1 FROM slopbot_value_attempt_completions WHERE attempt_id=?1)
      RETURNING attempt_id`)
    .bind(
      attemptId,
      key,
      expectedCalls,
      retained ? 1 : 0,
      new Date().toISOString(),
    )
    .first();
  if (!row) throw new Error("Value attempt completion was not recorded");
}

/** Paid provider attempts one inference key may start (PRD section 5:
 * immutable attempt records, duplicate refusal and queue limits). A retry
 * after a provider failure or an invalid result is a new paid attempt, so it
 * is bounded; a retained valid result is reused without any call.
 */
export const VALUE_INFERENCE_ATTEMPT_LIMIT = 3;

/** Supplied by the trusted consumer, never repository/model input. Capped mode
 * requires a maximum for the full route; alerts-only records costs without one.
 * No default authorizes expenditure.
 */
export type ValueInferenceBudget = {
  db: D1Database;
  installationId: number;
  attemptId: string;
  maximumMicroUsd: number | null;
  approvedMonthlyMicroUsd: number | null;
};

export async function runValueInference<T>(
  env: ModelEnv,
  prompt: Prompt,
  output: {
    sourceDigest: string;
    name: string;
    schema: Record<string, unknown>;
    validate(value: unknown): T | null;
  },
  mayCall: () => Promise<boolean>,
  budget: ValueInferenceBudget,
) {
  if (
    !Number.isSafeInteger(budget.installationId) ||
    budget.installationId <= 0
  )
    throw new Error("Value inference installation identity is invalid");
  // Check authority before holding any capacity. The route checks it again
  // before every request; a revocation during reservation still wins.
  if (!(await mayCall()))
    return {
      verdict: null,
      calls: [],
      servedBy: null,
      blocked: true,
      blockReason: "authority" as const,
    };
  if (!/^[a-f0-9]{64}$/.test(output.sourceDigest))
    throw new Error("Inference source digest is invalid");
  const key = await sha256Hex(
    JSON.stringify({
      installationId: budget.installationId,
      sourceDigest: output.sourceDigest,
      system: prompt.system,
      policy: prompt.policy,
      name: output.name,
      schema: output.schema,
      route: TRIAGE_ROUTE,
    }),
  );
  const retained = await readValueInference(budget.db, key, output.validate);
  if (retained) return { ...retained, blockReason: null };
  const blocked = async (
    reason: "attempts" | "attempts-pending" | "budget",
  ) => {
    if (reason === "attempts") {
      // A completing attempt may have retained its result after our first
      // read. Completion is later than retention; read that immutable result
      // before turning the absence observed earlier into terminal exhaustion.
      const completed = await readValueInference(
        budget.db,
        key,
        output.validate,
      );
      if (completed) return { ...completed, blockReason: null };
    }
    return {
      verdict: null,
      calls: [],
      servedBy: null,
      blocked: true,
      blockReason: reason,
    };
  };
  const admission = await admitValueAttempt(
    budget.db,
    key,
    budget.attemptId,
    VALUE_INFERENCE_ATTEMPT_LIMIT,
  );
  if (admission !== "admitted") return blocked(admission);
  const reservation = await reserveValueInferenceBudget(
    budget.db,
    budget.attemptId,
    key,
    VALUE_INFERENCE_ATTEMPT_LIMIT,
    budget.maximumMicroUsd,
    budget.approvedMonthlyMicroUsd,
  );
  if (reservation !== "reserved") return blocked(reservation);
  const result = await runStructuredRoute(
    env,
    TRIAGE_ROUTE,
    prompt,
    "high",
    output,
    mayCall,
  );
  // Failure to persist usage must prevent publication. The reservation remains
  // held after a crash or ambiguous result; never release it on a timer.
  await recordCalls(
    budget.db,
    budget.attemptId,
    budget.installationId,
    "triage",
    result.calls,
  );
  const inferredAt = new Date().toISOString();
  if (!result.blocked && result.verdict && result.servedBy) {
    await retainValueInference(budget.db, key, budget.attemptId, {
      verdict: result.verdict,
      calls: result.calls,
      servedBy: result.servedBy,
      blocked: false,
      inferredAt,
    });
  }
  await completeValueAttempt(
    budget.db,
    key,
    budget.attemptId,
    result.calls.length,
    Boolean(!result.blocked && result.verdict && result.servedBy),
  );
  // An explicit completion with no calls proves there is no provider charge.
  // Settle it before another attempt can reuse either paid-attempt or budget capacity.
  await reconcileValueBudget(budget.db, budget.attemptId, result.calls.length);
  if (!result.blocked && result.verdict && result.servedBy) {
    const completed = await readValueInference(budget.db, key, output.validate);
    if (!completed) throw new Error("Validated inference was not retained");
    return { ...completed, blockReason: null };
  }
  // A failed authority check is not a refusal by the registry; retry it.
  if (result.failure !== undefined) throw result.failure;
  // A provider spending denial is a budget block: the request keeps a retry
  // time and resumes after the provider budget resets.
  if (result.budgetResetAt !== undefined)
    return {
      ...result,
      inferredAt,
      blocked: true,
      blockReason: "budget" as const,
    };
  return {
    ...result,
    inferredAt,
    blockReason: result.blocked ? ("authority" as const) : null,
  };
}

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type CallRecord,
  type ModelEnv,
  type Prompt,
  runStructuredRoute,
  TRIAGE_ROUTE,
} from "./models";
import { type D1Database, recordCalls } from "./persistence";
import { reconcileValueBudget, reserveValueBudget } from "./value-budget";
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

/** Paid provider attempts one inference key may start (PRD section 5:
 * immutable attempt records, duplicate refusal and queue limits). A retry
 * after a provider failure or an invalid result is a new paid attempt, so it
 * is bounded; a retained valid result is reused without any call.
 */
export const VALUE_INFERENCE_ATTEMPT_LIMIT = 3;

/** Records one immutable attempt for this key, or refuses when the key has
 * already used every attempt that reserved budget. A recorded attempt whose
 * reservation was refused never reached the provider and does not count.
 */
async function admitValueAttempt(
  db: D1Database,
  key: string,
  attemptId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO slopbot_value_inference_attempts (attempt_id,inference_key,started_at)
       SELECT ?1,?2,?3 WHERE (
         SELECT COUNT(*) FROM slopbot_value_inference_attempts a
         JOIN slopbot_value_budget_reservations r ON r.attempt_id=a.attempt_id
         WHERE a.inference_key=?2) < ?4
       AND NOT EXISTS (SELECT 1 FROM slopbot_value_inference_attempts WHERE attempt_id=?1)
       RETURNING attempt_id`,
    )
    .bind(
      attemptId,
      key,
      new Date().toISOString(),
      VALUE_INFERENCE_ATTEMPT_LIMIT,
    )
    .first();
  return row !== null;
}

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
  if (!(await admitValueAttempt(budget.db, key, budget.attemptId)))
    return {
      verdict: null,
      calls: [],
      servedBy: null,
      blocked: true,
      blockReason: "attempts" as const,
    };
  if (
    !(await reserveValueBudget(
      budget.db,
      budget.attemptId,
      budget.maximumMicroUsd,
      budget.approvedMonthlyMicroUsd,
    ))
  )
    return {
      verdict: null,
      calls: [],
      servedBy: null,
      blocked: true,
      blockReason: "budget" as const,
    };
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
  if (result.calls.length)
    await reconcileValueBudget(
      budget.db,
      budget.attemptId,
      result.calls.length,
    );
  if (!result.blocked && result.verdict && result.servedBy) {
    const completed = await readValueInference(budget.db, key, output.validate);
    if (!completed) throw new Error("Validated inference was not retained");
    return { ...completed, blockReason: null };
  }
  // A failed authority check is not a refusal by the registry; retry it.
  if (result.failure !== undefined) throw result.failure;
  return {
    ...result,
    inferredAt,
    blockReason: result.blocked ? ("authority" as const) : null,
  };
}

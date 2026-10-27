import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { CallRecord } from "./models";
import type { D1Database } from "./persistence";
import { reconcileValueBudget } from "./value-budget";
import { valueProducerIdentity } from "./value-producer";

export type RetainedValueInference<T> = {
  verdict: T;
  calls: CallRecord[];
  servedBy: CallRecord;
  blocked: false;
  inferredAt: string;
};

/** Private operational storage; contains validated proposals and usage metadata,
 * never prompts, source bodies or unvalidated provider responses.
 */
export async function readValueInference<T>(
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

export async function retainValueInference<T>(
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

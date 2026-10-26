import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type ModelEnv,
  type Prompt,
  runStructuredRoute,
  TRIAGE_ROUTE,
} from "./models";
import { type D1Database, recordCalls } from "./persistence";
import { reconcileValueBudget, reserveValueBudget } from "./value-budget";
import {
  readValueInference,
  retainValueInference,
} from "./value-inference-results";

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
  return {
    ...result,
    inferredAt,
    blockReason: result.blocked ? ("authority" as const) : null,
  };
}

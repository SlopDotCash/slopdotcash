/** Owner-requested release of an untouched wrong-sum monthly reserve (PRD 6).
 * The request names a month and current policy. Only retained D1 allocations
 * supply recipients and amounts. This route cannot choose or submit a release.
 */
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import type { D1TransactionalDatabase } from "../d1";

export interface MonthlyReleaseRequest {
  projectId: string;
  period: string;
  network: EscrowDeployment["network"];
  manifestSha256: string;
}
export function isMonthlyReleaseRequest(
  value: unknown,
): value is MonthlyReleaseRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join(",") ===
      "manifestSha256,network,period,projectId" &&
    typeof v.projectId === "string" &&
    /^[a-z0-9][a-z0-9-]*$/.test(v.projectId) &&
    typeof v.period === "string" &&
    /^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(v.period) &&
    typeof v.network === "string" &&
    typeof v.manifestSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(v.manifestSha256)
  );
}
export async function retainedMonthlyAllocations(
  db: D1TransactionalDatabase,
  input: MonthlyReleaseRequest,
) {
  const run = await db
    .prepare(
      "SELECT snapshot_sha256,network,vault FROM monthly_payment_runs WHERE project_id=? AND period=? AND obligations_created_at IS NOT NULL",
    )
    .bind(input.projectId, input.period)
    .first<{ snapshot_sha256: string; network: string; vault: string }>();
  if (!run || run.network !== input.network) return [];
  // Retain every execution attempt: a prior signed attempt can win admission.
  const row = await db
    .prepare(
      "SELECT json_group_array(authorization) items FROM (SELECT authorization FROM monthly_payment_authorizations WHERE project_id=? AND period=? AND network=? UNION SELECT authorization FROM monthly_payment_authorization_attempts WHERE project_id=? AND period=? AND network=?)",
    )
    .bind(
      input.projectId,
      input.period,
      input.network,
      input.projectId,
      input.period,
      input.network,
    )
    .first<{ items: string }>();
  const values = JSON.parse(row?.items ?? "[]") as string[];
  const result: MonthlyAuthorization["plan"][] = [];
  for (const value of values) {
    const signed = JSON.parse(value) as MonthlyAuthorization;
    for (const plan of [signed.plan, signed.legacyAuthorization?.plan]) {
      if (!plan) continue;
      if (
        plan.request.projectId !== input.projectId ||
        plan.request.period !== input.period ||
        plan.request.network !== input.network ||
        plan.request.snapshotSha256 !== run.snapshot_sha256 ||
        plan.deployment.network !== input.network ||
        plan.deployment.vault !== run.vault ||
        !Array.isArray(plan.entries) ||
        !plan.entries.length
      )
        throw new Error(
          "Retained monthly allocation does not match its frozen month",
        );
      if (
        plan.entries.some(
          (entry) =>
            typeof entry.githubUserId !== "string" ||
            typeof entry.grossMicro !== "string" ||
            typeof entry.sourceDigest !== "string",
        )
      )
        throw new Error("Retained monthly allocation is incomplete");
      if (
        !result.some(
          (previous) => JSON.stringify(previous) === JSON.stringify(plan),
        )
      )
        result.push(plan);
    }
  }
  return result;
}

export interface MonthlyReleaseCheck extends MonthlyReleaseRequest {
  planId: string;
  transactionId: string;
}
export function isMonthlyReleaseCheck(
  value: unknown,
): value is MonthlyReleaseCheck {
  if (!value || typeof value !== "object") return false;
  const { planId, transactionId, ...request } = value as Record<
    string,
    unknown
  >;
  return (
    typeof planId === "string" &&
    /^[a-f0-9]{64}$/.test(planId) &&
    typeof transactionId === "string" &&
    transactionId.length <= 130 &&
    isMonthlyReleaseRequest(request)
  );
}

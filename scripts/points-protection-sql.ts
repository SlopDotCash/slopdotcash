/** Shared private settlement predicate for planning and atomic Points import. */
function protectedScope(project: string, period: string): string {
  return `(EXISTS (SELECT 1 FROM monthly_payment_runs m WHERE m.project_id=${project} AND m.period=${period}) OR EXISTS (SELECT 1 FROM monthly_allocation_changes m WHERE m.project_id=${project} AND m.period=${period}) OR EXISTS (SELECT 1 FROM payment_direct_transfers p WHERE p.project_id=${project} AND p.contribution_month=${period}) OR EXISTS (SELECT 1 FROM payment_obligations p WHERE p.project_id=${project} AND NOT EXISTS (SELECT 1 FROM monthly_payment_obligations m WHERE m.project_id=p.project_id AND m.network=p.network AND m.vault=p.vault AND m.source_digest=p.source_digest)))`;
}

export function protectedPointAwardSql(payload: string): string {
  if (!/^[a-z][a-z0-9_]*\.payload$/u.test(payload))
    throw new Error("Point protection requires a trusted payload column");
  return protectedScope(
    `json_extract(${payload},'$.award.projectId')`,
    `substr(json_extract(${payload},'$.award.occurredAt'),1,7)`,
  );
}

export interface PointProtectionScope {
  projectId: string;
  period: string;
}

/**
 * Private, read-only preflight. Keep its output in the trusted runner: the
 * existence of monthly allocations must not become a public source status.
 * Callers may batch scopes, but must account for every selected pool.
 */
export function pointProtectionQuery(
  scopes: readonly PointProtectionScope[],
): string {
  const unique = new Map<string, PointProtectionScope>();
  for (const scope of scopes) {
    if (
      typeof scope.projectId !== "string" ||
      !scope.projectId ||
      scope.projectId.includes("\0") ||
      typeof scope.period !== "string" ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(scope.period)
    )
      throw new Error("Invalid Points protection scope");
    unique.set(`${scope.projectId}\0${scope.period}`, scope);
  }
  if (unique.size === 0)
    return "SELECT NULL AS project_id,NULL AS period,0 AS protected WHERE 0;";
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const rows = [...unique.values()]
    .map(({ projectId, period }) => `(${quote(projectId)},${quote(period)})`)
    .join(",");
  return `WITH scopes(project_id,period) AS (VALUES ${rows}) SELECT scopes.project_id,scopes.period,CASE WHEN ${protectedScope("scopes.project_id", "scopes.period")} THEN 1 ELSE 0 END AS protected FROM scopes ORDER BY scopes.project_id,scopes.period;`;
}

/** Shared private settlement predicate for planning and atomic Points import. */
// PRD section 11 keeps the reviewed Base qualification outside earned rewards.
// Match its finalized payment and reservation source together, so an unknown
// or unresolved unscoped obligation still protects every month.
// https://github.com/SlopDotCash/slopdotcash/issues/904#issuecomment-6438995569
// The import serializes one SQL statement per line.
const baseQualificationPaid = `(
  p.id='0xe63ed9a7de8b38d1e847c4d850c7cb08d15ca429615c933eaefd9683b6367c4c'
  AND p.network='base-mainnet'
  AND p.vault='0x6c1297c3b96a00347cb501f572cb5811c2a8ed36'
  AND p.state='paid'
  AND p.source_digest='991cdcc980c86dee602eccb30c79290a51a67f4569b2292efad7211d62086ee3'
  AND p.paid_transaction IS '0x4b9290966d9bacbe77d0e936ccb749cc8c0b9622331bf8f4a42b965c1fa704d8'
  AND EXISTS (
    SELECT 1 FROM payment_events e
    WHERE e.network=p.network AND e.transaction_id=p.paid_transaction
      AND e.event_index=982 AND e.kind='paid' AND e.obligation_id=p.id
      AND CASE WHEN json_valid(e.evidence_json)
        THEN json_extract(e.evidence_json,'$.projectId')=p.project_id
        ELSE 0 END
  )
)`.replace(/\s+/gu, " ");

// Each table whose own row protects one project month, with the column that
// names the month. The predicate and the private listing below are both built
// from this list, so they cannot name different tables.
const protectedMonthSources = [
  { table: "monthly_payment_runs", alias: "m", period: "period" },
  { table: "monthly_allocation_changes", alias: "m", period: "period" },
  {
    table: "payment_direct_transfers",
    alias: "p",
    period: "contribution_month",
  },
] as const;

/**
 * A payment obligation that no monthly allocation accounts for, other than
 * the reviewed Base qualification payment. It protects every month of its
 * project.
 */
function unmappedObligation(project: string): string {
  return `EXISTS (SELECT 1 FROM payment_obligations p WHERE p.project_id=${project} AND NOT ${baseQualificationPaid} AND NOT EXISTS (SELECT 1 FROM monthly_payment_obligations m WHERE m.project_id=p.project_id AND m.network=p.network AND m.vault=p.vault AND m.source_digest=p.source_digest))`;
}

function protectedScope(project: string, period: string): string {
  const months = protectedMonthSources.map(
    ({ table, alias, period: column }) =>
      `EXISTS (SELECT 1 FROM ${table} ${alias} WHERE ${alias}.project_id=${project} AND ${alias}.${column}=${period})`,
  );
  return `(${[...months, unmappedObligation(project)].join(" OR ")})`;
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

/**
 * Private listing of every project month that a row of its own protects: the
 * same tables and month columns as the predicate above. One statement; keep
 * its output private, like the preflight.
 */
export function protectedPointMonthsQuery(): string {
  const sources = protectedMonthSources
    .map(
      ({ table, period }) =>
        `SELECT project_id,${period} AS period FROM ${table}`,
    )
    .join(" UNION ");
  return `SELECT project_id,period FROM (${sources}) ORDER BY project_id,period;`;
}

/**
 * Private listing of every project that the predicate protects in every
 * month: the same unmapped-obligation clause, asked once per project that has
 * an obligation.
 */
export function protectedPointProjectsQuery(): string {
  return `SELECT DISTINCT o.project_id FROM payment_obligations o WHERE ${unmappedObligation("o.project_id")} ORDER BY o.project_id;`;
}

import type { D1Database } from "./persistence";
import type { ValueClaim } from "./value-processing";

type Source = { repositoryDatabaseId: number; pullRequestNumber: number };
export function valueSourceScopeKeys(sources: readonly Source[]) {
  if (
    !sources.length ||
    sources.some(
      (source) =>
        ![source.repositoryDatabaseId, source.pullRequestNumber].every(
          (id) => Number.isSafeInteger(id) && id > 0,
        ),
    )
  )
    throw new Error("Invalid valuation source identities");
  const keys = sources.map(
    (source) => `${source.repositoryDatabaseId}:${source.pullRequestNumber}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error("Repeated valuation source identity");
  return JSON.stringify(keys.sort());
}

/** All-or-none source ownership in one SQLite statement. Overlapping groups
 * cannot spend twice even when their webhook deliveries name different PRs.
 */
export async function claimValueSources(
  db: D1Database,
  claim: ValueClaim,
  sources: readonly Source[],
  at = new Date(),
) {
  const keys = valueSourceScopeKeys(sources);
  const stamp = at.toISOString();
  await db
    .prepare(`INSERT INTO slopbot_value_source_leases(scope_key,delivery_id,claim_token,lease_until)
    SELECT wanted.value,owner.delivery_id,owner.claim_token,owner.lease_until
    FROM json_each(?1) wanted JOIN slopbot_value_processing owner ON owner.delivery_id=?2
    WHERE owner.claim_token=?3 AND owner.state='running' AND owner.lease_until>?4
      AND NOT EXISTS (
        SELECT 1 FROM slopbot_value_source_leases held
        JOIN json_each(?1) requested ON requested.value=held.scope_key
        JOIN slopbot_value_processing active ON active.delivery_id=held.delivery_id AND active.claim_token=held.claim_token
        WHERE held.claim_token<>?3 AND active.state='running' AND active.lease_until>?4 AND held.lease_until>?4
      )
    ON CONFLICT(scope_key) DO UPDATE SET delivery_id=excluded.delivery_id,claim_token=excluded.claim_token,lease_until=excluded.lease_until`)
    .bind(keys, claim.deliveryId, claim.token, stamp)
    .run();
  return ownsValueSources(db, claim, sources, at);
}

export async function ownsValueSources(
  db: D1Database,
  claim: ValueClaim,
  sources: readonly Source[],
  at = new Date(),
) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM slopbot_value_source_leases held
    JOIN json_each(?1) wanted ON wanted.value=held.scope_key
    JOIN slopbot_value_processing owner ON owner.delivery_id=held.delivery_id AND owner.claim_token=held.claim_token
    WHERE owner.delivery_id=?2 AND owner.claim_token=?3 AND owner.state='running' AND owner.lease_until>?4 AND held.lease_until>?4`)
    .bind(
      valueSourceScopeKeys(sources),
      claim.deliveryId,
      claim.token,
      at.toISOString(),
    )
    .first<{ n: number }>();
  return row?.n === sources.length;
}

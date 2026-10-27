import type { D1Database } from "./persistence";

export type ValueClaim = {
  deliveryId: string;
  token: string;
  claimedAt: string;
};
export type ValueOutcome =
  | "published"
  | "current"
  | "open"
  | "historical"
  | "source-incomplete"
  | "authority"
  | "budget"
  | "retry";
const terminal = new Set<ValueOutcome>([
  "published",
  "current",
  "open",
  "historical",
]);
const LEASE_MS = 10 * 60 * 1000;

/** Claim an existing durable request. One atomic statement handles the first
 * attempt, scheduled retries and recovery after a worker disappears.
 */
export async function claimValueRequest(
  db: D1Database,
  deliveryId: string,
  at = new Date(),
): Promise<ValueClaim | null> {
  const stamp = at.toISOString();
  const token = crypto.randomUUID();
  const row = await db
    .prepare(
      `INSERT INTO slopbot_value_processing
       (delivery_id,claim_token,lease_until,state,updated_at)
       SELECT ?1,?2,?3,'running',?4
       WHERE EXISTS(SELECT 1 FROM slopbot_value_requests WHERE delivery_id=?1)
       AND NOT EXISTS (
         SELECT 1 FROM slopbot_value_processing busy
         JOIN slopbot_value_requests other ON other.delivery_id=busy.delivery_id
         JOIN slopbot_value_requests requested ON requested.delivery_id=?1
         WHERE busy.delivery_id<>?1 AND busy.state='running' AND busy.lease_until>?4
           AND other.repository_id=requested.repository_id
           AND other.pull_request_number=requested.pull_request_number
       )
       ON CONFLICT(delivery_id) DO UPDATE SET claim_token=?2,lease_until=?3,
         state='running',outcome=NULL,retry_at=NULL,updated_at=?4
       WHERE (slopbot_value_processing.state='running' AND slopbot_value_processing.lease_until<=?4)
          OR (slopbot_value_processing.state='waiting' AND slopbot_value_processing.retry_at<=?4)
       RETURNING claim_token`,
    )
    .bind(
      deliveryId,
      token,
      new Date(at.getTime() + LEASE_MS).toISOString(),
      stamp,
    )
    .first();
  return row ? { deliveryId, token, claimedAt: stamp } : null;
}

export async function ownsValueRequest(
  db: D1Database,
  claim: ValueClaim,
  at = new Date(),
): Promise<boolean> {
  return (
    (await db
      .prepare(
        `SELECT 1 AS ok FROM slopbot_value_processing
         WHERE delivery_id=? AND claim_token=? AND state='running' AND lease_until>?`,
      )
      .bind(claim.deliveryId, claim.token, at.toISOString())
      .first()) !== null
  );
}

/** Outcomes are fixed codes, never model output or provider exception text.
 * Incomplete evidence and budget/authority blocks remain retryable, not zero.
 * The consumer reads the PR from GitHub after its claim, so the outcome also
 * settles every waiting or unread delivery received by the claim time that
 * names the same installation, repository and PR: every input of the outcome
 * is then the same. A later delivery, or one under another installation or
 * repository name, keeps its own request.
 */
export async function finishValueRequest(
  db: D1Database,
  claim: ValueClaim,
  outcome: ValueOutcome,
  retryAt: Date | null,
  at = new Date(),
) {
  const complete = terminal.has(outcome);
  if (
    (complete && retryAt !== null) ||
    (!complete &&
      (!retryAt || !Number.isFinite(retryAt.getTime()) || retryAt <= at))
  )
    throw new Error("Value request retry time does not match its outcome");
  // One statement: without the current lease no row is selected or written.
  const row = await db
    .prepare(
      `INSERT INTO slopbot_value_processing
       (delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at)
       SELECT r.delivery_id,?2,?7,?4,?5,?6,?7
       FROM slopbot_value_processing owner
       JOIN slopbot_value_requests claimed ON claimed.delivery_id=owner.delivery_id
       JOIN slopbot_value_requests r ON r.repository_id=claimed.repository_id
         AND r.pull_request_number=claimed.pull_request_number
         AND r.installation_id=claimed.installation_id
         AND r.owner=claimed.owner AND r.repo=claimed.repo
         AND (r.delivery_id=owner.delivery_id OR r.received_at<=?3)
       WHERE owner.delivery_id=?1 AND owner.claim_token=?2
         AND owner.state='running' AND owner.lease_until>?7
       ON CONFLICT(delivery_id) DO UPDATE SET claim_token=excluded.claim_token,
         state=excluded.state,outcome=excluded.outcome,retry_at=excluded.retry_at,
         updated_at=excluded.updated_at
       WHERE slopbot_value_processing.delivery_id=?1
          OR slopbot_value_processing.state='waiting'
       RETURNING delivery_id`,
    )
    .bind(
      claim.deliveryId,
      claim.token,
      claim.claimedAt,
      complete ? "completed" : "waiting",
      outcome,
      retryAt?.toISOString() ?? null,
      at.toISOString(),
    )
    .first();
  if (!row) throw new Error("Value request lease is no longer owned");
}

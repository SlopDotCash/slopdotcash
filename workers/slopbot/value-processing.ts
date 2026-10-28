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
  | "missing"
  | "attempts-exhausted"
  | "source-incomplete"
  | "authority"
  | "parked"
  | "budget"
  | "retry";
/** Final, recorded outcomes. `missing` is a pull request GitHub reports as
 * absent (404) in a repository the installation still reads, and
 * `attempts-exhausted` is a source digest that used every paid attempt. Neither
 * is an assessment or implies a low value.
 */
const terminal = new Set<ValueOutcome>([
  "published",
  "current",
  "open",
  "historical",
  "missing",
  "attempts-exhausted",
]);
const LEASE_MS = 10 * 60 * 1000;

/** The first retry delay, and the cadence kept for a transient failure. */
const VALUE_RETRY_BASE_MS = 60 * 60 * 1000;
/** Longest retry delay of a blocked outcome: never more than one day. */
const VALUE_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * Delay before attempt `attempt` (1 is the first) of an outcome that is blocked
 * rather than failing transiently: the base interval doubled once per earlier
 * attempt, capped at one day, so a block that persists stops costing an hourly
 * run without turning the outcome into a final zero.
 */
export function valueRetryDelayMs(attempt: number): number {
  const step = Math.max(Math.trunc(attempt), 1) - 1;
  return Math.min(VALUE_RETRY_BASE_MS * 2 ** step, VALUE_RETRY_MAX_MS);
}

/**
 * The retry time for this outcome, from the attempts already recorded for this
 * delivery. `retry` is the transient path — a thrown failure, a source-lease
 * contention or a provider outage — so it keeps the plain one-hour cadence and
 * only the blocked outcomes back off. The count belongs to one delivery: the
 * claimed row is the only one that advances.
 */
export async function nextValueRetryAt(
  db: D1Database,
  deliveryId: string,
  outcome: ValueOutcome,
  at = new Date(),
): Promise<Date> {
  if (outcome === "retry") return new Date(at.getTime() + VALUE_RETRY_BASE_MS);
  const row = await db
    .prepare(
      "SELECT attempts FROM slopbot_value_processing WHERE delivery_id=?",
    )
    .bind(deliveryId)
    .first<{ attempts: number }>();
  return new Date(at.getTime() + valueRetryDelayMs((row?.attempts ?? 0) + 1));
}

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
  // A parked request waits with no retry time until its project is active.
  const parked = outcome === "parked";
  if (
    ((complete || parked) && retryAt !== null) ||
    (!complete &&
      !parked &&
      (!retryAt || !Number.isFinite(retryAt.getTime()) || retryAt <= at))
  )
    throw new Error("Value request retry time does not match its outcome");
  // Only a blocked outcome advances the count. A transient 'retry' also carries
  // a retry time, and counting it would let a provider outage push a later,
  // unrelated block straight to the day cap. Parking is not an attempt.
  const blocked = !complete && !parked && outcome !== "retry";
  // One statement: without the current lease no row is selected or written.
  const row = await db
    .prepare(
      `INSERT INTO slopbot_value_processing
       (delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,attempts)
       SELECT r.delivery_id,?2,?7,?4,?5,?6,?7,?8
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
         -- The delivery_id predicate is load-bearing, not redundant: the SELECT
         -- also settles every waiting sibling delivery of the same PR, and this
         -- row UPSERT is what inserts them, so without it they would be credited
         -- with attempts they never made and their count would drift upward.
         attempts=CASE WHEN slopbot_value_processing.delivery_id=?1 AND ?9=1
           THEN slopbot_value_processing.attempts+1
           ELSE slopbot_value_processing.attempts END,
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
      0,
      blocked ? 1 : 0,
    )
    .first();
  if (!row) throw new Error("Value request lease is no longer owned");
}

/** Gives parked requests a retry time again once their repository is active.
 * Reads at most `limit` distinct repositories per run; the live registry is
 * the authority, and a read failure propagates. Returns the resumed count.
 */
export async function resumeParkedValueRequests(
  db: D1Database,
  isActive: (repository: {
    owner: string;
    repo: string;
    repositoryId: number;
  }) => Promise<boolean>,
  at = new Date(),
  limit = 20,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT json_group_array(json_object('owner',owner,'repo',repo,
         'repositoryId',repositoryId)) AS rows_json FROM (
       SELECT DISTINCT r.owner,r.repo,r.repository_id AS repositoryId
       FROM slopbot_value_processing p
       JOIN slopbot_value_requests r ON r.delivery_id=p.delivery_id
       WHERE p.outcome='parked' AND p.state='waiting' AND p.retry_at IS NULL
       ORDER BY r.repository_id,r.owner,r.repo LIMIT ?)`,
    )
    .bind(limit)
    .first<{ rows_json: string }>();
  if (!row) throw new Error("Parked value requests are unreadable");
  const repositories = JSON.parse(row.rows_json) as {
    owner: string;
    repo: string;
    repositoryId: number;
  }[];
  let resumed = 0;
  for (const repository of repositories) {
    if (!(await isActive(repository))) continue;
    const result = await db
      .prepare(
        `UPDATE slopbot_value_processing SET retry_at=?1,updated_at=?1
         WHERE outcome='parked' AND state='waiting' AND retry_at IS NULL
           AND delivery_id IN (
           SELECT delivery_id FROM slopbot_value_requests
           WHERE repository_id=?2 AND owner=?3 AND repo=?4)`,
      )
      .bind(
        at.toISOString(),
        repository.repositoryId,
        repository.owner,
        repository.repo,
      )
      .run();
    resumed += result.meta?.changes ?? 0;
  }
  return resumed;
}

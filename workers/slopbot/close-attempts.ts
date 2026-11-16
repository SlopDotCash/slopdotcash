import { REOPEN_BREAKER_RATIO, type Verdict } from "./contracts";
import type { CallRecord } from "./models";
import type { D1TransactionalDatabase, ReviewClaim } from "./persistence";
import {
  VALUE_PUBLICATION_FENCE_SQL,
  type ValuePublicationFence,
  valuePublicationFenceValues,
} from "./value-publication-fence";

export type CloseRecovery = {
  verdict: Verdict;
  triage: CallRecord | null;
  confirm: CallRecord | null;
};

/** Same seven-day reversal policy at advisory read and atomic reservation. */
export function reopenBreakerSql(repository: "?1" | "?3"): string {
  return `(SELECT closes = 0 OR reversed * 1.0 / closes <= ${REOPEN_BREAKER_RATIO} FROM (
    SELECT (SELECT COUNT(*) FROM slopbot_actions WHERE repository_id = ${repository}
      AND action = 'close' AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')) AS closes,
    (SELECT COUNT(DISTINCT reversal.item_node_id) FROM (
      SELECT r.item_node_id, r.created_at AS at FROM slopbot_actions r
        WHERE r.repository_id = ${repository} AND r.action = 'human_reopen'
      UNION ALL
      SELECT a.item_node_id, a.resolved_at AS at FROM slopbot_appeals a
        WHERE a.repository_id = ${repository} AND a.resolution = 'upheld'
          AND a.appeal_key NOT LIKE 'value-appeal:%'
    ) reversal WHERE reversal.at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
      AND EXISTS (SELECT 1 FROM slopbot_actions c WHERE c.repository_id = ${repository}
        AND c.item_node_id = reversal.item_node_id AND c.action = 'close'
        AND c.created_at <= reversal.at)) AS reversed
  ))`;
}

type CloseAttempt = {
  attempt_id: string;
  review_key: string;
  repository_id: number;
  project_id: string;
  item_node_id: string;
  author_id: number;
  revision: string;
  recovery_json: string;
  penalty_eligible: number;
  state: "pending" | "confirmed" | "rejected";
  closed_at: string | null;
  comment_confirmed: number;
};

/** Includes a confirmed close whose later comment/notification still failed. */
export async function unfinishedClose(
  db: D1TransactionalDatabase,
  itemNodeId: string,
): Promise<CloseAttempt | null> {
  return db
    .prepare(`SELECT c.* FROM slopbot_close_attempts c
    JOIN slopbot_reviews r ON r.review_key = c.review_key
    WHERE c.item_node_id = ? AND (c.state = 'pending' OR (c.state = 'confirmed' AND r.status != 'completed'))
    ORDER BY c.state = 'pending' DESC, c.created_at DESC, c.rowid DESC LIMIT 1`)
    .bind(itemNodeId)
    .first<CloseAttempt>();
}

/** One serialized SQL write owns the slot before any external request starts. */
export async function reserveClose(
  db: D1TransactionalDatabase,
  claim: ReviewClaim,
  input: {
    repositoryId: number;
    projectId: string;
    itemNodeId: string;
    authorId: number;
    revision: string;
    dailyCap: number;
    penaltyEligible: boolean;
    recovery: CloseRecovery;
    fence: ValuePublicationFence;
  },
): Promise<string | null> {
  const result = await db
    .prepare(`INSERT OR IGNORE INTO slopbot_close_attempts
    (attempt_id, review_key, repository_id, project_id, item_node_id, author_id, revision,
     recovery_json, penalty_eligible, state, created_at)
    SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE EXISTS (SELECT 1 FROM slopbot_reviews WHERE review_key = ?1 AND claim_token = ?2
      AND status = 'running' AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND NOT EXISTS (SELECT 1 FROM slopbot_actions WHERE review_key = ?1 AND action = 'close')
    AND (SELECT COUNT(*) FROM slopbot_actions WHERE repository_id = ?3 AND action = 'close'
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))
      + (SELECT COUNT(*) FROM slopbot_close_attempts c WHERE c.repository_id = ?3 AND c.state = 'pending'
        AND NOT EXISTS (SELECT 1 FROM slopbot_actions a WHERE a.review_key = c.review_key AND a.action = 'close')) < ?10
    AND ${reopenBreakerSql("?3")}
    AND ${VALUE_PUBLICATION_FENCE_SQL}`)
    .bind(
      claim.reviewKey,
      claim.token,
      input.repositoryId,
      input.projectId,
      input.itemNodeId,
      input.authorId,
      input.revision,
      JSON.stringify(input.recovery),
      input.penaltyEligible ? 1 : 0,
      input.dailyCap,
      ...valuePublicationFenceValues(input.fence),
    )
    .run();
  return result.meta?.changes === 1 ? claim.token : null;
}

/** The fact and reservation settle together; capacity never has an empty gap. */
export async function confirmClose(
  db: D1TransactionalDatabase,
  attemptId: string,
  closedAt: Date,
): Promise<void> {
  const at = closedAt.toISOString();
  await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO slopbot_actions
      (review_key, repository_id, item_node_id, action, detail, created_at)
      SELECT review_key, repository_id, item_node_id, 'close',
        json_object('category', json_extract(recovery_json, '$.verdict.category'),
          'penaltyEligible', json(CASE penalty_eligible WHEN 1 THEN 'true' ELSE 'false' END)), ?2
      FROM slopbot_close_attempts WHERE attempt_id = ?1 AND state IN ('pending','confirmed')`)
      .bind(attemptId, at),
    db
      .prepare(`UPDATE slopbot_close_attempts SET state = 'confirmed', closed_at = ?2
      WHERE attempt_id = ?1 AND state = 'pending'
        AND EXISTS (SELECT 1 FROM slopbot_actions a WHERE a.review_key = slopbot_close_attempts.review_key AND a.action = 'close')`)
      .bind(attemptId, at),
  ]);
}

/** Only an authoritative no-effect response releases a sent attempt. */
export async function rejectClose(
  db: D1TransactionalDatabase,
  attemptId: string,
) {
  await db
    .prepare(
      "UPDATE slopbot_close_attempts SET state = 'rejected', rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE attempt_id = ? AND state = 'pending'",
    )
    .bind(attemptId)
    .run();
}

export async function confirmCloseComment(
  db: D1TransactionalDatabase,
  reviewKey: string,
) {
  await db
    .prepare(
      "UPDATE slopbot_close_attempts SET comment_confirmed = 1 WHERE review_key = ? AND state = 'confirmed'",
    )
    .bind(reviewKey)
    .run();
}

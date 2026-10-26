// PRD sections 5 and 9: a lost response is not permission to post again.
import { findReviewComment, type GitHubClient, sha256Hex } from "./github";
import {
  type D1TransactionalDatabase,
  hasRecordedAction,
  REVIEW_LEASE_SECONDS,
  ReviewBusyError,
  ReviewLeaseLostError,
} from "./persistence";

export async function publishAppealComment(
  db: D1TransactionalDatabase,
  github: GitHubClient,
  input: {
    key: string;
    owner: string;
    repo: string;
    number: number;
    repositoryId: number;
    itemNodeId: string;
    appUserId: string;
    stage: string;
    body: string;
  },
  authorize: () => Promise<unknown>,
) {
  if (await hasRecordedAction(db, input.key, "comment")) return;
  const token = crypto.randomUUID();
  const at = new Date().toISOString();
  const expires = new Date(
    Date.parse(at) + REVIEW_LEASE_SECONDS * 1000,
  ).toISOString();
  const claim = await db
    .prepare(
      `INSERT INTO slopbot_appeal_publications(publication_key,claim_token,lease_expires_at)
       VALUES(?,?,?) ON CONFLICT(publication_key) DO UPDATE SET
       claim_token=excluded.claim_token,lease_expires_at=excluded.lease_expires_at
       WHERE lease_expires_at IS NULL OR lease_expires_at <= ?
       RETURNING post_started_at,confirmed_comment_id`,
    )
    .bind(input.key, token, expires, at)
    .first<{
      post_started_at: string | null;
      confirmed_comment_id: number | null;
    }>();
  if (!claim) throw new ReviewBusyError(REVIEW_LEASE_SECONDS);
  const fence = "publication_key=? AND claim_token=? AND lease_expires_at>?";
  try {
    // A delivery may have finished between our first read and lease acquisition.
    if (await hasRecordedAction(db, input.key, "comment")) return;
    await authorize();
    const marker = `<!-- slopbot:appeal:${await sha256Hex(input.key)} -->`;
    let commentId =
      claim.confirmed_comment_id ??
      (await findReviewComment(
        github,
        input.owner,
        input.repo,
        input.number,
        input.appUserId,
        marker,
      ));
    if (commentId === null) {
      if (claim.post_started_at !== null)
        throw new Error(
          "Appeal comment delivery is uncertain; awaiting GitHub reconciliation",
        );
      await authorize();
      const started = await db
        .prepare(
          `UPDATE slopbot_appeal_publications SET post_started_at=? WHERE ${fence} AND post_started_at IS NULL`,
        )
        .bind(
          new Date().toISOString(),
          input.key,
          token,
          new Date().toISOString(),
        )
        .run();
      if (started.meta?.changes !== 1) throw new ReviewLeaseLostError();
      // Persist before POST. Even a terminated consumer must reconcile, not resend.
      const created = await github.request<{ id: number }>(
        "POST",
        `/repos/${input.owner}/${input.repo}/issues/${input.number}/comments`,
        { body: `${marker}\n${input.body}` },
      );
      if (
        created.status !== 201 ||
        created.data === null ||
        !Number.isSafeInteger(created.data?.id) ||
        (created.data?.id ?? 0) <= 0
      )
        throw new Error("GitHub did not confirm the appeal comment");
      commentId = created.data.id;
    }
    const confirmedAt = new Date().toISOString();
    const results = await db.batch([
      db
        .prepare(
          `UPDATE slopbot_appeal_publications SET confirmed_comment_id=? WHERE ${fence}`,
        )
        .bind(commentId, input.key, token, confirmedAt),
      db
        .prepare(`INSERT OR IGNORE INTO slopbot_actions(review_key,repository_id,item_node_id,action,detail,created_at)
        SELECT ?,?,?,'comment',?,? FROM slopbot_appeal_publications
        WHERE ${fence} AND confirmed_comment_id=?`)
        .bind(
          input.key,
          input.repositoryId,
          input.itemNodeId,
          input.stage,
          confirmedAt,
          input.key,
          token,
          confirmedAt,
          commentId,
        ),
    ]);
    if (results[0].meta?.changes !== 1) throw new ReviewLeaseLostError();
  } finally {
    // A late holder cannot clear its successor's lease. Keep any pending POST.
    await db
      .prepare(
        "UPDATE slopbot_appeal_publications SET claim_token=NULL,lease_expires_at=NULL WHERE publication_key=? AND claim_token=?",
      )
      .bind(input.key, token)
      .run();
  }
}

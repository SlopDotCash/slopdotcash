// Monthly cap on Slopbot's free advisory reviews (operator decision,
// 16 November 2026). Value assessment, points disputes and value disputes are
// a separate pipeline and are never counted or refused here.

import type { D1Database } from "./persistence";

/** Free advisory reviews one repository may start in one UTC calendar month. */
export const FREE_REVIEWS_PER_REPO_PER_MONTH = 2000;

/** Recorded as the review's skip reason when the monthly cap refuses it. */
export const MONTHLY_REVIEW_CAP_REASON = "monthly-review-cap";

/** UTC calendar month, `YYYY-MM`. */
export function reviewMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** Admit one advisory review before any model call. A review key counts once
 * per repository and month, however many model calls or retries it makes. The
 * insert and its count are one statement, so parallel reviews cannot push a
 * repository past the cap. Returns false when the month's cap is reached.
 */
export async function admitMonthlyReview(
  db: D1Database,
  repositoryId: number,
  reviewKey: string,
  at: Date = new Date(),
): Promise<boolean> {
  const month = reviewMonth(at);
  await db
    .prepare(
      `INSERT OR IGNORE INTO slopbot_review_month_starts (repository_id, month, review_key, started_at)
       SELECT ?1, ?2, ?3, ?4
       WHERE (SELECT COUNT(*) FROM slopbot_review_month_starts
              WHERE repository_id = ?1 AND month = ?2) < ?5`,
    )
    .bind(
      repositoryId,
      month,
      reviewKey,
      at.toISOString(),
      FREE_REVIEWS_PER_REPO_PER_MONTH,
    )
    .run();
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM slopbot_review_month_starts WHERE repository_id = ? AND month = ? AND review_key = ?",
    )
    .bind(repositoryId, month, reviewKey)
    .first();
  return row !== null;
}

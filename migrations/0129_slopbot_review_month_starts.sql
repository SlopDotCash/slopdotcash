-- Monthly cap on free advisory reviews (operator decision, 16 November 2026).
-- One row per advisory review started, per repository and UTC calendar month.
-- `workers/slopbot/review-cap.ts` admits a review only while the repository has
-- fewer than FREE_REVIEWS_PER_REPO_PER_MONTH rows for the month; a retry of
-- the same review key in the same month reuses its row and is not counted
-- again. Value assessment and disputes never write here.
CREATE TABLE slopbot_review_month_starts (
 repository_id INTEGER NOT NULL,
 month TEXT NOT NULL CHECK (length(month) = 7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
 review_key TEXT NOT NULL,
 started_at TEXT NOT NULL,
 PRIMARY KEY (repository_id, month, review_key)
) STRICT;

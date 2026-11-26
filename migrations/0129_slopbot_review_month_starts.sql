-- Monthly cap on free advisory reviews (operator decision, 16 November 2026).
-- One row per pull request or issue reviewed, per repository and UTC calendar
-- month. `workers/slopbot/review-cap.ts` admits a new item only while the
-- repository has fewer than FREE_REVIEWS_PER_REPO_PER_MONTH items for the
-- month; any later review of an admitted item in the same month (new pushes,
-- a moved base, retries) reuses its row and is never refused. Value
-- assessment and disputes never write here.
CREATE TABLE slopbot_review_month_starts (
 repository_id INTEGER NOT NULL,
 month TEXT NOT NULL CHECK (length(month) = 7 AND month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
 item_kind TEXT NOT NULL CHECK (item_kind IN ('issue','pull_request')),
 item_number INTEGER NOT NULL,
 started_at TEXT NOT NULL,
 PRIMARY KEY (repository_id, month, item_kind, item_number)
) STRICT;

-- Merge activity per registered repository (#1993, operator decision of
-- 15 November 2026). A daily scheduled read of public GitHub facts through
-- the Slopbot App: when the repository last merged a pull request, how many
-- outside pull requests have waited seven days or more without a response
-- from anyone who can merge, and how long outside pull requests merged in the
-- last 30 days took. Project pages read these rows; they never read GitHub
-- per page view (PRD section 9).
--
-- `observed_at` is the last successful read. A failed read only moves
-- `attempted_at` and records `failure`, so the page keeps the last values
-- with their date, never zeros.
CREATE TABLE repository_merge_activity (
  project_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  observed_at TEXT,
  attempted_at TEXT NOT NULL,
  failure TEXT,
  last_merged_at TEXT,
  waiting_outside INTEGER CHECK (waiting_outside IS NULL OR waiting_outside >= 0),
  waiting_capped INTEGER CHECK (waiting_capped IS NULL OR waiting_capped IN (0, 1)),
  merged_outside_30d INTEGER CHECK (merged_outside_30d IS NULL OR merged_outside_30d >= 0),
  median_merge_hours REAL CHECK (median_merge_hours IS NULL OR median_merge_hours >= 0),
  PRIMARY KEY (project_id, repository)
);

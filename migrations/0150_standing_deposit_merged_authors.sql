-- The standing deposit (operator decision, 23 November 2026; PRD section 5).
-- A standing deposit covers a pull request on a project only when its author
-- already has a merged pull request on that project's registered
-- repositories. Slopbot asks GitHub's search once and keeps a positive answer
-- here for a day, so every pull request of a regular contributor does not
-- cost a search. A negative or failed answer is never stored.
CREATE TABLE standing_deposit_merged_authors (
  project_id TEXT NOT NULL,
  github_id INTEGER NOT NULL CHECK (github_id > 0),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (project_id, github_id)
) STRICT;

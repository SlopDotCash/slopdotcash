-- Private trace contract version 3 (operator decision, 23 November 2026).
-- Port of main 0151 (PR #3323): trace_runs accepts 'private-trace-v3'.
--
-- Vibestack difference: migration 0148 (trace licensing, issue #3295) was
-- not ported, so trace_runs has no terms_version column yet and
-- trace_licensing_events does not exist on this branch. This migration
-- therefore adds terms_version last on trace_runs with the widened CHECK
-- from the start, instead of widening an existing CHECK, and it does not
-- touch trace_licensing_events: that table and its v3 widening belong to
-- the #3295 port. Existing rows keep terms_version NULL, which the CHECK
-- allows, because no terms version was recorded for them.
--
-- SQLite cannot alter a CHECK in place, so trace_runs is rebuilt in the
-- order proven in 0017: copy every row aside into a plain holding table,
-- drop the original, create the replacement under its own name with every
-- original column, constraint and index, re-insert every row, then drop
-- the holding table.
--
-- The trace_runs_account_finalized index does not exist on this branch, so
-- it is created here to match main's schema after 0151 instead of being
-- dropped and recreated.
--
-- Foreign keys: tables that reference trace_runs(id) are looked up while
-- the parent is dropped and re-inserted. Dropping a referenced parent
-- counts each orphaned child row as a deferred violation; re-inserting the
-- parent rows under the original name clears it. The replacement is never
-- renamed into place, because a rename does not clear that count on D1.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

-- With foreign keys enforced (always on D1), dropping and re-inserting a parent
-- looks up its child rows in every referencing table. Three of them have no
-- index on run_id, which turns each lookup into a full scan. These indexes
-- make each lookup direct; they are dropped at the end, so the migration's
-- only lasting change is the new terms_version column and its CHECK, plus
-- the trace_runs_account_finalized index.
CREATE INDEX trace_upload_intents_0151_run ON trace_upload_intents(run_id);
CREATE INDEX trace_uploads_0151_run ON trace_uploads(run_id);
CREATE INDEX trace_attachment_commits_0151_run ON trace_attachment_commits(run_id);

-- trace_runs (0001; terms_version added here, where main 0148 added it)
CREATE TABLE trace_runs_0151_copy (
  id TEXT, client_run_id TEXT, github_user_id TEXT, github_login TEXT,
  project_id TEXT, repository TEXT, project_policy_revision TEXT,
  provider TEXT, model TEXT, client TEXT, client_version TEXT, state TEXT,
  trace_sha256 TEXT, created_at TEXT, finalized_at TEXT,
  create_idempotency_key TEXT
) STRICT;
INSERT INTO trace_runs_0151_copy (
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key
)
SELECT
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key
FROM trace_runs;
DROP TABLE trace_runs;
CREATE TABLE trace_runs (
  id TEXT PRIMARY KEY,
  client_run_id TEXT NOT NULL,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  project_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  project_policy_revision TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  client TEXT NOT NULL,
  client_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('awaiting_trace', 'trace_uploaded', 'finalized')),
  trace_sha256 TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  create_idempotency_key TEXT NOT NULL,
  terms_version TEXT CHECK (terms_version IS NULL OR terms_version IN (
    'private-trace-v1', 'private-trace-v2', 'private-trace-v3'
  )),
  UNIQUE (github_user_id, create_idempotency_key),
  CHECK (trace_sha256 IS NULL OR length(trace_sha256) = 64),
  CHECK (state != 'finalized' OR (trace_sha256 IS NOT NULL AND finalized_at IS NOT NULL))
) STRICT;
INSERT INTO trace_runs (
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key
)
SELECT
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key
FROM trace_runs_0151_copy;
DROP TABLE trace_runs_0151_copy;
CREATE INDEX trace_runs_account_finalized ON trace_runs(github_user_id, finalized_at);

DROP INDEX trace_upload_intents_0151_run;
DROP INDEX trace_uploads_0151_run;
DROP INDEX trace_attachment_commits_0151_run;

PRAGMA foreign_keys = ON;

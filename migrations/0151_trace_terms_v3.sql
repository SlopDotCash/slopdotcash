-- Private trace contract version 3 (operator decision, 23 November 2026).
-- Widen the terms_version CHECK on trace_runs and trace_licensing_events to
-- accept 'private-trace-v3'. SQLite cannot alter a CHECK in place, so each
-- table is rebuilt in the order proven in 0017: copy every row aside into a
-- plain holding table, drop the original (triggers first), create the
-- replacement under its own name with every original column, constraint and
-- index, re-insert every row, then drop the holding table. Column order is
-- unchanged (terms_version stays last on trace_runs, where 0148 added it).
--
-- Foreign keys: seven tables reference trace_runs(id) and trace_licence_events
-- references trace_licensing_events(id). Dropping a referenced parent counts
-- each orphaned child row as a deferred violation; re-inserting the parent
-- rows under the original name clears it. The replacement is never renamed
-- into place, because a rename does not clear that count on D1.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

-- With foreign keys enforced (always on D1), dropping and re-inserting a parent
-- looks up its child rows in every referencing table. Three of them have no
-- index on run_id and trace_licence_events none on account_event_id, which
-- turns each lookup into a full scan (about 14 seconds on a copy of
-- production). These indexes make each lookup direct; they are dropped at the
-- end, so the migration's only lasting change is the widened CHECKs.
CREATE INDEX trace_upload_intents_0149_run ON trace_upload_intents(run_id);
CREATE INDEX trace_uploads_0149_run ON trace_uploads(run_id);
CREATE INDEX trace_attachment_commits_0149_run ON trace_attachment_commits(run_id);
CREATE INDEX trace_licence_events_0149_account_event ON trace_licence_events(account_event_id);

-- trace_runs (0001, terms_version added 0148)
CREATE TABLE trace_runs_0149_copy (
  id TEXT, client_run_id TEXT, github_user_id TEXT, github_login TEXT,
  project_id TEXT, repository TEXT, project_policy_revision TEXT,
  provider TEXT, model TEXT, client TEXT, client_version TEXT, state TEXT,
  trace_sha256 TEXT, created_at TEXT, finalized_at TEXT,
  create_idempotency_key TEXT, terms_version TEXT
) STRICT;
INSERT INTO trace_runs_0149_copy (
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version
)
SELECT
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version
FROM trace_runs;
DROP INDEX trace_runs_account_finalized;
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
  trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version
)
SELECT
  id, client_run_id, github_user_id, github_login, project_id, repository,
  project_policy_revision, provider, model, client, client_version, state,
  trace_sha256, created_at, finalized_at, create_idempotency_key, terms_version
FROM trace_runs_0149_copy;
DROP TABLE trace_runs_0149_copy;
CREATE INDEX trace_runs_account_finalized ON trace_runs(github_user_id, finalized_at);

-- trace_licensing_events (0148). Ids are kept, so licence events keep their
-- account_event_id and the AUTOINCREMENT sequence continues past them.
CREATE TABLE trace_licensing_events_0149_copy (
  id INTEGER, github_id TEXT, kind TEXT, terms_version TEXT,
  affected_count INTEGER, at TEXT
) STRICT;
INSERT INTO trace_licensing_events_0149_copy (
  id, github_id, kind, terms_version, affected_count, at
)
SELECT id, github_id, kind, terms_version, affected_count, at
FROM trace_licensing_events;
DROP TRIGGER trace_licensing_events_no_update;
DROP TRIGGER trace_licensing_events_no_delete;
DROP INDEX trace_licensing_events_account;
DROP TABLE trace_licensing_events;
CREATE TABLE trace_licensing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('enabled', 'disabled', 'opted_in', 'account_closed')),
  terms_version TEXT NOT NULL CHECK (terms_version IN (
    'private-trace-v1', 'private-trace-v2', 'private-trace-v3'
  )),
  affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  at TEXT NOT NULL
) STRICT;
INSERT INTO trace_licensing_events (
  id, github_id, kind, terms_version, affected_count, at
)
SELECT id, github_id, kind, terms_version, affected_count, at
FROM trace_licensing_events_0149_copy;
DROP TABLE trace_licensing_events_0149_copy;
CREATE INDEX trace_licensing_events_account ON trace_licensing_events(github_id, id);
CREATE TRIGGER trace_licensing_events_no_update BEFORE UPDATE ON trace_licensing_events
BEGIN SELECT RAISE(ABORT, 'trace licensing history is append-only'); END;
CREATE TRIGGER trace_licensing_events_no_delete BEFORE DELETE ON trace_licensing_events
BEGIN SELECT RAISE(ABORT, 'trace licensing history is append-only'); END;

DROP INDEX trace_upload_intents_0149_run;
DROP INDEX trace_uploads_0149_run;
DROP INDEX trace_attachment_commits_0149_run;
DROP INDEX trace_licence_events_0149_account_event;

PRAGMA foreign_keys = ON;

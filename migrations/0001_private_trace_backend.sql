-- Private trace bodies are never stored in D1. PRIVATE_TRACES R2 is the only
-- blob store and intentionally has no deletion or lifecycle path.
PRAGMA foreign_keys = ON;

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
  UNIQUE (github_user_id, create_idempotency_key),
  CHECK (trace_sha256 IS NULL OR length(trace_sha256) = 64),
  CHECK (state != 'finalized' OR (trace_sha256 IS NOT NULL AND finalized_at IS NOT NULL))
) STRICT;

CREATE TABLE trace_objects (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  r2_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  content_type TEXT NOT NULL CHECK (content_type IN ('text/plain', 'application/x-ndjson')),
  created_by_github_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE trace_uploads (
  github_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES trace_runs(id),
  trace_sha256 TEXT NOT NULL REFERENCES trace_objects(sha256),
  created_at TEXT NOT NULL,
  PRIMARY KEY (github_user_id, idempotency_key)
) STRICT;

CREATE TABLE trace_upload_intents (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  run_id TEXT NOT NULL REFERENCES trace_runs(id),
  github_user_id TEXT NOT NULL,
  trace_sha256 TEXT NOT NULL CHECK (length(trace_sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  content_type TEXT NOT NULL CHECK (content_type IN ('text/plain', 'application/x-ndjson')),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (github_user_id, idempotency_key)
) STRICT;

CREATE TABLE run_progress_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES trace_runs(id),
  github_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'run_started', 'task_selected', 'work_started', 'checkpoint',
    'pull_request_opened', 'review_requested', 'merged', 'run_completed', 'run_failed'
  )),
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('agent', 'github')),
  github_object_id TEXT,
  github_url TEXT,
  head_sha TEXT,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (github_user_id, idempotency_key)
) STRICT;

CREATE INDEX run_progress_events_run ON run_progress_events(run_id, occurred_at);

CREATE TABLE trace_read_grants (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  trace_sha256 TEXT NOT NULL REFERENCES trace_objects(sha256),
  operator_github_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 8 AND 500),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE TABLE private_audit_events (
  id TEXT PRIMARY KEY,
  actor_github_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json))
) STRICT;

CREATE INDEX private_audit_events_target ON private_audit_events(target, created_at);

-- A GitHub issue is the sufficient primary claim. This table also supports an
-- operator-recorded D1 fallback when GitHub is temporarily unavailable.
CREATE TABLE wallet_claims (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('github_issue', 'profile_readme', 'd1_fallback')),
  issue_repository TEXT,
  issue_number INTEGER,
  source_body_sha256 TEXT NOT NULL CHECK (length(source_body_sha256) = 64),
  observed_at TEXT NOT NULL,
  record_sha256 TEXT NOT NULL UNIQUE CHECK (length(record_sha256) = 64),
  supersedes_claim_id TEXT REFERENCES wallet_claims(id),
  created_at TEXT NOT NULL,
  CHECK (
    source != 'github_issue' OR
    (issue_repository IS NOT NULL AND issue_number IS NOT NULL AND issue_number > 0)
  )
) STRICT;

CREATE INDEX wallet_claims_actor ON wallet_claims(github_user_id, observed_at);

CREATE TRIGGER wallet_claims_no_update
BEFORE UPDATE ON wallet_claims
BEGIN
  SELECT RAISE(ABORT, 'wallet claims are immutable');
END;

CREATE TRIGGER wallet_claims_no_delete
BEFORE DELETE ON wallet_claims
BEGIN
  SELECT RAISE(ABORT, 'wallet claims are permanent');
END;

-- The final insert in the D1 batch is an assertion as well as an immutable
-- receipt. Any missing or mismatched earlier write aborts the whole batch, so
-- JavaScript postcondition checks are not relied on for rollback.
--
-- Wrangler's statement splitter closes a trigger body at the first END
-- keyword, so trigger bodies here must not contain nested conditionals;
-- the validation predicate lives in the trigger WHEN clause instead. The first
-- deployment attempt applied the table before failing on the original
-- trigger, so every statement is idempotent.
CREATE TABLE IF NOT EXISTS trace_attachment_commits (
  token_hash TEXT PRIMARY KEY REFERENCES trace_upload_intents(token_hash),
  run_id TEXT NOT NULL REFERENCES trace_runs(id),
  github_user_id TEXT NOT NULL,
  trace_sha256 TEXT NOT NULL REFERENCES trace_objects(sha256),
  consumed_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS trace_attachment_commit_validate
BEFORE INSERT ON trace_attachment_commits
WHEN NOT EXISTS (
  SELECT 1
  FROM trace_upload_intents AS intent
  JOIN trace_uploads AS upload
    ON upload.github_user_id = intent.github_user_id
   AND upload.idempotency_key = intent.token_hash
   AND upload.run_id = intent.run_id
   AND upload.trace_sha256 = intent.trace_sha256
  JOIN trace_objects AS object ON object.sha256 = intent.trace_sha256
  JOIN trace_runs AS run
    ON run.id = intent.run_id
   AND run.github_user_id = intent.github_user_id
   AND run.trace_sha256 = intent.trace_sha256
   AND run.state = 'trace_uploaded'
  WHERE intent.token_hash = NEW.token_hash
    AND intent.run_id = NEW.run_id
    AND intent.github_user_id = NEW.github_user_id
    AND intent.trace_sha256 = NEW.trace_sha256
    AND intent.consumed_at = NEW.consumed_at
    AND object.size_bytes = intent.size_bytes
    AND object.content_type = intent.content_type
)
BEGIN
  SELECT RAISE(ABORT, 'incomplete trace attachment');
END;

CREATE TRIGGER IF NOT EXISTS trace_attachment_commits_no_update
BEFORE UPDATE ON trace_attachment_commits
BEGIN
  SELECT RAISE(ABORT, 'trace attachment commits are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trace_attachment_commits_no_delete
BEFORE DELETE ON trace_attachment_commits
BEGIN
  SELECT RAISE(ABORT, 'trace attachment commits are permanent');
END;

-- A batch after-statement can fail after the batch commits: the case
-- revision advanced and the audit event landed, but the action's side
-- effect never happened. The event row alone would replay as success, so
-- the failure itself is recorded here and a same-key retry replays the
-- original 409 instead of a false 200 (PRD §9: never report a partial
-- write as success). One row per (case, key): the event row already
-- guarantees at most one failed attempt per key.
CREATE TABLE security_case_action_failures (
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 80),
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 3 AND 40),
  actor_github_id TEXT NOT NULL,
  error TEXT NOT NULL CHECK (length(error) BETWEEN 1 AND 100),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  at TEXT NOT NULL,
  PRIMARY KEY (case_id, idempotency_key)
) STRICT;
CREATE TRIGGER security_case_action_failures_no_update
BEFORE UPDATE ON security_case_action_failures
BEGIN SELECT RAISE(ABORT, 'case action failure is immutable'); END;
CREATE TRIGGER security_case_action_failures_no_delete
BEFORE DELETE ON security_case_action_failures
BEGIN SELECT RAISE(ABORT, 'case action failures are permanent'); END;
CREATE TRIGGER security_case_action_failures_no_replace
BEFORE INSERT ON security_case_action_failures
WHEN EXISTS (SELECT 1 FROM security_case_action_failures WHERE case_id=NEW.case_id AND idempotency_key=NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'case action failure already exists'); END;

-- A reservation may still have an in-flight response or pending retained
-- result. Only an explicit completion record closes that attempt. Existing
-- cost and result rows cannot prove the missing completion, so do not backfill.
CREATE TABLE slopbot_value_attempt_completions (
 attempt_id TEXT PRIMARY KEY REFERENCES slopbot_value_budget_reservations(attempt_id),
 completed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER slopbot_value_attempt_completions_no_update
BEFORE UPDATE ON slopbot_value_attempt_completions
BEGIN SELECT RAISE(ABORT, 'value attempt completion is immutable'); END;
CREATE TRIGGER slopbot_value_attempt_completions_no_delete
BEFORE DELETE ON slopbot_value_attempt_completions
BEGIN SELECT RAISE(ABORT, 'value attempt completion is immutable'); END;
CREATE TRIGGER slopbot_value_attempt_completions_no_replace
BEFORE INSERT ON slopbot_value_attempt_completions
WHEN EXISTS (SELECT 1 FROM slopbot_value_attempt_completions WHERE attempt_id=NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'value attempt completion already exists'); END;

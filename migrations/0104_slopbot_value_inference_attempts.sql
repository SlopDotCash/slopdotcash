-- PRD section 5: keep immutable attempt records, duplicate refusal and queue
-- limits for ongoing value scoring.
--
-- A retry after a provider failure or an invalid result is a new paid
-- provider attempt. Bound them per inference key (installation, source digest,
-- prompt, schema and route); a changed source has a new key. One immutable
-- row per attempt. Only an attempt that reserved budget, and so could reach
-- the provider, counts toward the limit.
CREATE TABLE slopbot_value_inference_attempts (
 attempt_id TEXT PRIMARY KEY,
 inference_key TEXT NOT NULL CHECK(length(inference_key) = 64),
 started_at TEXT NOT NULL
) STRICT;
CREATE INDEX slopbot_value_inference_attempts_key
 ON slopbot_value_inference_attempts(inference_key);
CREATE TRIGGER slopbot_value_inference_attempts_no_update BEFORE UPDATE ON slopbot_value_inference_attempts
BEGIN SELECT RAISE(ABORT, 'value inference attempts are immutable'); END;
CREATE TRIGGER slopbot_value_inference_attempts_no_delete BEFORE DELETE ON slopbot_value_inference_attempts
BEGIN SELECT RAISE(ABORT, 'value inference attempts are immutable'); END;

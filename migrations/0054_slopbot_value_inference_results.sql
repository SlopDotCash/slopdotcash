-- Retain validated outcomes after usage recording, before journal publication.
CREATE TABLE slopbot_value_inference_results (
 inference_key TEXT PRIMARY KEY CHECK(length(inference_key)=64),
 attempt_id TEXT NOT NULL REFERENCES slopbot_value_budget_reservations(attempt_id),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 result_digest TEXT NOT NULL CHECK(length(result_digest)=64),
 recorded_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER slopbot_value_inference_results_no_update BEFORE UPDATE ON slopbot_value_inference_results
BEGIN SELECT RAISE(ABORT, 'inference result is immutable'); END;
CREATE TRIGGER slopbot_value_inference_results_no_delete BEFORE DELETE ON slopbot_value_inference_results
BEGIN SELECT RAISE(ABORT, 'inference result is immutable'); END;
CREATE TRIGGER slopbot_value_inference_results_no_replace BEFORE INSERT ON slopbot_value_inference_results
WHEN EXISTS(SELECT 1 FROM slopbot_value_inference_results WHERE inference_key=NEW.inference_key)
BEGIN SELECT RAISE(ABORT, 'inference result already exists'); END;

-- PRD section 5: keep immutable attempt records, duplicate refusal and queue
-- limits for ongoing value scoring.
--
-- 1. `missing`: GitHub answers 404 for a pull request in a repository that the
--    installation can still read. The request ends, recorded, instead of
--    retrying as `source-incomplete` forever.
-- 2. `parked`: the project is paused, retired or unregistered. The request
--    waits with no retry time, so it is never claimed hourly; the scheduler
--    gives it a retry time again once the repository is active.
-- 3. `attempts-exhausted`: one source digest has used every paid provider
--    attempt it may use (0104). A changed source has a new digest and new
--    attempts. This is not an assessment and never implies a low value.
CREATE TABLE slopbot_value_processing_next (
 delivery_id TEXT PRIMARY KEY REFERENCES slopbot_value_requests(delivery_id),
 claim_token TEXT NOT NULL,
 lease_until TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','waiting','completed')),
 outcome TEXT CHECK(outcome IN ('published','current','open','historical','missing','attempts-exhausted','source-incomplete','authority','parked','budget','retry')),
 retry_at TEXT,
 updated_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO slopbot_value_processing_next
 (delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,attempts)
 SELECT delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,attempts
 FROM slopbot_value_processing;
DROP TABLE slopbot_value_processing;
ALTER TABLE slopbot_value_processing_next RENAME TO slopbot_value_processing;
CREATE INDEX slopbot_value_processing_running
 ON slopbot_value_processing(state, lease_until);
CREATE INDEX slopbot_value_processing_parked
 ON slopbot_value_processing(outcome) WHERE outcome = 'parked';

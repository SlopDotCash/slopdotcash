-- PRD section 5: ongoing API assessment starts on 1 November 2026, and
-- September and October go through the subscription intake. A request for a
-- PR closed before the start ends as `historical` instead of waiting forever.
CREATE TABLE slopbot_value_processing_next (
 delivery_id TEXT PRIMARY KEY REFERENCES slopbot_value_requests(delivery_id),
 claim_token TEXT NOT NULL,
 lease_until TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','waiting','completed')),
 outcome TEXT CHECK(outcome IN ('published','current','open','historical','source-incomplete','authority','budget','retry')),
 retry_at TEXT,
 updated_at TEXT NOT NULL
) STRICT;
INSERT INTO slopbot_value_processing_next SELECT * FROM slopbot_value_processing;
DROP TABLE slopbot_value_processing;
ALTER TABLE slopbot_value_processing_next RENAME TO slopbot_value_processing;

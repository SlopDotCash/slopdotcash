-- Operational claim state; immutable request and publication histories stay separate.
CREATE TABLE slopbot_value_processing (
 delivery_id TEXT PRIMARY KEY REFERENCES slopbot_value_requests(delivery_id),
 claim_token TEXT NOT NULL,
 lease_until TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','waiting','completed')),
 outcome TEXT CHECK(outcome IN ('published','current','open','source-incomplete','authority','budget','retry')),
 retry_at TEXT,
 updated_at TEXT NOT NULL
) STRICT;

-- PRD sections 5 and 9: serialize appeal comments and reconcile uncertain sends.
CREATE TABLE slopbot_appeal_publications (
 publication_key TEXT PRIMARY KEY,
 claim_token TEXT,
 lease_expires_at TEXT,
 post_started_at TEXT,
 confirmed_comment_id INTEGER CHECK(confirmed_comment_id > 0),
 CHECK((claim_token IS NULL) = (lease_expires_at IS NULL))
) STRICT;

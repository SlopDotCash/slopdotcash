-- Trusted, independently confirmed objective defects only. No penalties.
CREATE TABLE slopbot_quality_shadow (
 review_key TEXT PRIMARY KEY,
 repository_id INTEGER NOT NULL,
 item_node_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 policy_digest TEXT NOT NULL,
 profile_sha256 TEXT NOT NULL,
 verifier_key TEXT NOT NULL,
 defect_id TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;

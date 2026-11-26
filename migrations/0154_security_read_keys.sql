-- A personal read-only key for the private security reads (PRD section 8).
-- A reviewer's script uses it instead of a browser sign-in, which lasts an
-- hour. Only the SHA-256 of a key is kept. An account has at most one key in
-- use; creating another or revoking sets revoked_at. A key can only read what
-- its account could read signed in, and it can write nothing.
CREATE TABLE security_read_keys (
 key_sha256 TEXT PRIMARY KEY CHECK (length(key_sha256) = 64),
 github_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT,
 last_used_at TEXT
);
CREATE UNIQUE INDEX security_read_key_in_use
 ON security_read_keys(github_id) WHERE revoked_at IS NULL;

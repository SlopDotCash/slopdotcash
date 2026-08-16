CREATE TABLE identity_rate_limits (
  key_hash TEXT PRIMARY KEY CHECK (length(key_hash) = 64),
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  window_started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > window_started_at)
) STRICT;

CREATE INDEX identity_rate_limits_expiry ON identity_rate_limits(expires_at);

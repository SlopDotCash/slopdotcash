CREATE TABLE identity_oauth_flows (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE CHECK (length(state_hash) = 64),
  poll_capability_hash TEXT NOT NULL UNIQUE CHECK (length(poll_capability_hash) = 64),
  encrypted_pkce_verifier TEXT,
  pkce_iv TEXT,
  audience TEXT NOT NULL CHECK (audience = 'private-trace-api'),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'callback_processing', 'callback_complete', 'assertion_issued'
  )),
  github_actor_id TEXT,
  github_login TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  callback_completed_at TEXT,
  assertion_issued_at TEXT,
  CHECK (
    status = 'pending' OR
    (encrypted_pkce_verifier IS NULL AND pkce_iv IS NULL)
  ),
  CHECK (
    status NOT IN ('callback_complete', 'assertion_issued') OR
    (github_actor_id IS NOT NULL AND github_login IS NOT NULL)
  )
) STRICT;

CREATE INDEX identity_oauth_flows_expiry ON identity_oauth_flows(expires_at);

CREATE TABLE identity_assertions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  github_actor_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience = 'private-trace-api'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE INDEX identity_assertions_expiry ON identity_assertions(expires_at);

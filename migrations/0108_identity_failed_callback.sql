-- A callback whose GitHub exchange fails is terminal: the poller sees the
-- failure at once instead of a pending reply until the flow expires. Nothing
-- leaves callback_failed.
CREATE TABLE identity_oauth_flows_next (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE CHECK (length(state_hash) = 64),
  poll_capability_hash TEXT NOT NULL UNIQUE CHECK (length(poll_capability_hash) = 64),
  encrypted_pkce_verifier TEXT,
  pkce_iv TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('private-trace-api', 'slop-points-web')),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'callback_processing', 'callback_complete', 'assertion_issued',
    'callback_failed'
  )),
  github_actor_id TEXT,
  github_login TEXT,
  github_node_id TEXT,
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

INSERT INTO identity_oauth_flows_next SELECT id,state_hash,poll_capability_hash,encrypted_pkce_verifier,pkce_iv,audience,status,github_actor_id,github_login,github_node_id,created_at,expires_at,callback_completed_at,assertion_issued_at FROM identity_oauth_flows;
DROP TABLE identity_oauth_flows;
ALTER TABLE identity_oauth_flows_next RENAME TO identity_oauth_flows;
CREATE INDEX identity_oauth_flows_expiry ON identity_oauth_flows(expires_at);

CREATE TRIGGER identity_oauth_flows_failed_terminal BEFORE UPDATE ON identity_oauth_flows
WHEN OLD.status = 'callback_failed'
BEGIN SELECT RAISE(ABORT, 'failed identity flow is terminal'); END;

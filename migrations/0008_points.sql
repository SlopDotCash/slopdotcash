CREATE TABLE identity_oauth_flows_next (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE CHECK (length(state_hash) = 64),
  poll_capability_hash TEXT NOT NULL UNIQUE CHECK (length(poll_capability_hash) = 64),
  encrypted_pkce_verifier TEXT,
  pkce_iv TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('private-trace-api', 'slop-points-web')),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'callback_processing', 'callback_complete', 'assertion_issued'
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

CREATE INDEX identity_oauth_flows_next_expiry ON identity_oauth_flows_next(expires_at);

CREATE TABLE identity_assertions_next (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  github_actor_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  github_node_id TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('private-trace-api', 'slop-points-web')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE INDEX identity_assertions_next_expiry ON identity_assertions_next(expires_at);

INSERT INTO identity_oauth_flows_next (id,state_hash,poll_capability_hash,encrypted_pkce_verifier,pkce_iv,audience,status,github_actor_id,github_login,created_at,expires_at,callback_completed_at,assertion_issued_at) SELECT id,state_hash,poll_capability_hash,encrypted_pkce_verifier,pkce_iv,audience,status,github_actor_id,github_login,created_at,expires_at,callback_completed_at,assertion_issued_at FROM identity_oauth_flows;
DROP TABLE identity_oauth_flows;
ALTER TABLE identity_oauth_flows_next RENAME TO identity_oauth_flows;

INSERT INTO identity_assertions_next (token_hash,github_actor_id,github_login,audience,created_at,expires_at,consumed_at) SELECT token_hash,github_actor_id,github_login,audience,created_at,expires_at,consumed_at FROM identity_assertions;
DROP TABLE identity_assertions;
ALTER TABLE identity_assertions_next RENAME TO identity_assertions;

-- Public points metadata uses its own tables; no trace joins or read routes.
CREATE TABLE points_members (
 actor_id TEXT PRIMARY KEY, github_id TEXT NOT NULL UNIQUE, login TEXT NOT NULL,
 joined_at TEXT NOT NULL, public INTEGER NOT NULL CHECK(public IN (0,1)),
 welcome INTEGER NOT NULL DEFAULT 5 CHECK(welcome = 5)
) STRICT;
CREATE TRIGGER points_members_identity BEFORE UPDATE ON points_members
WHEN NEW.actor_id != OLD.actor_id OR NEW.github_id != OLD.github_id OR NEW.joined_at != OLD.joined_at OR NEW.welcome != OLD.welcome
BEGIN SELECT RAISE(ABORT, 'immutable points membership'); END;
CREATE TRIGGER points_members_no_delete BEFORE DELETE ON points_members
BEGIN SELECT RAISE(ABORT, 'points membership preserves welcome uniqueness'); END;
CREATE TABLE points_sessions (
 token_hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES points_members(actor_id), expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE points_revisions (
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL, previous TEXT REFERENCES points_revisions(id),
 recorded_at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 UNIQUE(previous)
) STRICT;
CREATE UNIQUE INDEX points_one_root ON points_revisions(source_key) WHERE previous IS NULL;
CREATE TRIGGER points_revision_chain BEFORE INSERT ON points_revisions
WHEN NEW.previous IS NOT NULL AND NOT EXISTS (SELECT 1 FROM points_revisions WHERE id = NEW.previous AND source_key = NEW.source_key)
BEGIN SELECT RAISE(ABORT, 'invalid points successor'); END;
CREATE TRIGGER points_no_update BEFORE UPDATE ON points_revisions BEGIN SELECT RAISE(ABORT, 'append-only points'); END;
CREATE TRIGGER points_no_delete BEFORE DELETE ON points_revisions BEGIN SELECT RAISE(ABORT, 'append-only points'); END;
CREATE TABLE points_batches (digest TEXT PRIMARY KEY, generated_at TEXT NOT NULL, coverage TEXT NOT NULL CHECK(json_valid(coverage)), revision_count INTEGER NOT NULL) STRICT;


CREATE TABLE points_staging (
 batch_id TEXT NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(batch_id,sequence)
) STRICT;
-- A complete staged upload is applied in one atomic statement. Failed uploads
-- can be retried without exposing partial history or blocking a new candidate.
CREATE TRIGGER points_complete_batch BEFORE INSERT ON points_batches
BEGIN
 SELECT RAISE(ABORT, 'incomplete points upload') WHERE (SELECT COUNT(*) FROM points_staging WHERE batch_id=NEW.digest) != NEW.revision_count;
 SELECT RAISE(ABORT, 'conflicting points revision') WHERE EXISTS (
   SELECT 1 FROM points_staging s JOIN points_revisions r ON r.id=json_extract(s.payload,'$.id')
   WHERE s.batch_id=NEW.digest AND s.payload != r.payload
 );
 INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload)
 SELECT json_extract(payload,'$.id'),json_extract(payload,'$.award.key'),json_extract(payload,'$.previous'),json_extract(payload,'$.recordedAt'),payload
 FROM points_staging WHERE batch_id=NEW.digest ORDER BY sequence
 ON CONFLICT(id) DO NOTHING;
 SELECT RAISE(ABORT, 'divergent points batch') WHERE NEW.revision_count != (SELECT COUNT(*) FROM points_revisions);
END;
CREATE TRIGGER points_clear_staging AFTER INSERT ON points_batches
BEGIN DELETE FROM points_staging WHERE batch_id=NEW.digest; END;

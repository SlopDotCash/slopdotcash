CREATE TABLE points_x_claims (
 x_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES points_members(actor_id), claimed_at TEXT NOT NULL,
 UNIQUE(x_id,actor_id)
) STRICT;
CREATE TRIGGER points_x_claims_no_update BEFORE UPDATE ON points_x_claims BEGIN SELECT RAISE(ABORT,'immutable X attribution'); END;
CREATE TRIGGER points_x_claims_no_delete BEFORE DELETE ON points_x_claims BEGIN SELECT RAISE(ABORT,'X attribution prevents duplicate awards'); END;
CREATE TABLE points_x_awards (
 actor_id TEXT PRIMARY KEY REFERENCES points_members(actor_id), x_id TEXT NOT NULL UNIQUE,
 awarded_at TEXT NOT NULL, points INTEGER NOT NULL CHECK(points=10),
 FOREIGN KEY(x_id,actor_id) REFERENCES points_x_claims(x_id,actor_id)
) STRICT;
CREATE TRIGGER points_x_awards_no_update BEFORE UPDATE ON points_x_awards BEGIN SELECT RAISE(ABORT,'immutable connection award'); END;
CREATE TRIGGER points_x_awards_no_delete BEFORE DELETE ON points_x_awards BEGIN SELECT RAISE(ABORT,'connection awards are permanent'); END;
CREATE TABLE points_x_links (
 actor_id TEXT PRIMARY KEY REFERENCES points_members(actor_id), x_id TEXT NOT NULL UNIQUE,
 username TEXT NOT NULL, verified_at TEXT NOT NULL, public INTEGER NOT NULL CHECK(public IN(0,1)),
 FOREIGN KEY(x_id,actor_id) REFERENCES points_x_claims(x_id,actor_id)
) STRICT;
CREATE TABLE points_x_flows (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, session_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES points_members(actor_id), verifier TEXT NOT NULL, iv TEXT NOT NULL,
 expires_at TEXT NOT NULL, public INTEGER NOT NULL CHECK(public IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('pending','processing'))
) STRICT;
CREATE INDEX points_x_flows_expiry ON points_x_flows(expires_at);

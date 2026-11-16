-- Telegram connections (protocol/points-v1.md "Telegram connections", PRD
-- SOC-02). Mirrors the X tables of 0009 without an award table: a verified
-- Telegram account is reserved to one GitHub identity for good, the visible
-- link is removable, and the flow row is the single-use code behind the bot
-- deep link. Only the numeric account ID, an optional username snapshot, the
-- verification time and the visibility choice are stored.
CREATE TABLE points_telegram_claims (
 telegram_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES points_members(actor_id), claimed_at TEXT NOT NULL,
 UNIQUE(telegram_id,actor_id)
) STRICT;
CREATE TRIGGER points_telegram_claims_no_update BEFORE UPDATE ON points_telegram_claims BEGIN SELECT RAISE(ABORT,'immutable Telegram attribution'); END;
CREATE TRIGGER points_telegram_claims_no_delete BEFORE DELETE ON points_telegram_claims BEGIN SELECT RAISE(ABORT,'Telegram attribution prevents reuse across accounts'); END;
CREATE TABLE points_telegram_links (
 actor_id TEXT PRIMARY KEY REFERENCES points_members(actor_id), telegram_id TEXT NOT NULL UNIQUE,
 username TEXT, verified_at TEXT NOT NULL, public INTEGER NOT NULL CHECK(public IN(0,1)),
 FOREIGN KEY(telegram_id,actor_id) REFERENCES points_telegram_claims(telegram_id,actor_id)
) STRICT;
CREATE TABLE points_telegram_flows (
 code_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES points_members(actor_id),
 expires_at TEXT NOT NULL, public INTEGER NOT NULL CHECK(public IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('pending','processing'))
) STRICT;
CREATE INDEX points_telegram_flows_expiry ON points_telegram_flows(expires_at);
CREATE INDEX points_telegram_flows_actor ON points_telegram_flows(actor_id);

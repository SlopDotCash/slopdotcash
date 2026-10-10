-- SCR-01 negative events for confirmed Slopbot closures (protocol/slopbot-v2.md,
-- effective 2026-11-01T00:00:00Z). points_revisions is a batch checkpoint: every
-- upload verifies its row count and digest, so a worker cannot append to it.
-- Worker-written point events live beside it, like points_x_awards. Each item
-- gets one debit and at most one reversing successor. The fixed amounts mean
-- Slopbot cannot choose or change a debit.
CREATE TABLE points_penalties (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 item_node_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('debit','reversal')),
 previous INTEGER REFERENCES points_penalties(id),
 actor_id TEXT NOT NULL REFERENCES points_members(actor_id),
 repository_id INTEGER NOT NULL,
 review_key TEXT NOT NULL,
 policy_digest TEXT NOT NULL,
 reason TEXT NOT NULL,
 points INTEGER NOT NULL,
 score_thirds INTEGER NOT NULL,
 occurred_at TEXT NOT NULL CHECK(kind = 'reversal' OR occurred_at >= '2026-11-01T00:00:00.000Z'),
 recorded_at TEXT NOT NULL,
 UNIQUE(item_node_id, kind),
 CHECK(
   (kind = 'debit' AND previous IS NULL AND points = -10 AND score_thirds = -3) OR
   (kind = 'reversal' AND previous IS NOT NULL AND points = 10 AND score_thirds = 3)
 )
) STRICT;
CREATE INDEX points_penalties_actor ON points_penalties(actor_id, occurred_at);
CREATE TRIGGER points_penalties_successor BEFORE INSERT ON points_penalties
WHEN NEW.kind = 'reversal' AND NOT EXISTS (
 SELECT 1 FROM points_penalties WHERE id = NEW.previous AND kind = 'debit'
   AND item_node_id = NEW.item_node_id AND actor_id = NEW.actor_id
)
BEGIN SELECT RAISE(ABORT, 'invalid penalty successor'); END;
CREATE TRIGGER points_penalties_no_update BEFORE UPDATE ON points_penalties
BEGIN SELECT RAISE(ABORT, 'append-only penalties'); END;
CREATE TRIGGER points_penalties_no_delete BEFORE DELETE ON points_penalties
BEGIN SELECT RAISE(ABORT, 'append-only penalties'); END;

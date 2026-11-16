-- Reserve capacity before GitHub receives a close. An unknown result remains
-- pending without an expiry: a request may still complete after its caller dies.
CREATE TABLE slopbot_close_attempts (
 attempt_id TEXT PRIMARY KEY,
 review_key TEXT NOT NULL REFERENCES slopbot_reviews(review_key),
 repository_id INTEGER NOT NULL,
 project_id TEXT NOT NULL,
 item_node_id TEXT NOT NULL,
 author_id INTEGER NOT NULL,
 revision TEXT NOT NULL,
 recovery_json TEXT NOT NULL CHECK(json_valid(recovery_json)),
 penalty_eligible INTEGER NOT NULL CHECK(penalty_eligible IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('pending','confirmed','rejected')),
 created_at TEXT NOT NULL,
 closed_at TEXT,
 rejected_at TEXT,
 comment_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(comment_confirmed IN (0,1)),
 CHECK(comment_confirmed = 0 OR state = 'confirmed'),
 CHECK((state = 'pending' AND closed_at IS NULL AND rejected_at IS NULL) OR
       (state = 'confirmed' AND closed_at IS NOT NULL AND rejected_at IS NULL) OR
       (state = 'rejected' AND closed_at IS NULL AND rejected_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX slopbot_one_pending_close_per_item
 ON slopbot_close_attempts(item_node_id) WHERE state = 'pending';
CREATE UNIQUE INDEX slopbot_one_confirmed_close_per_review
 ON slopbot_close_attempts(review_key) WHERE state = 'confirmed';
CREATE INDEX slopbot_close_attempts_capacity
 ON slopbot_close_attempts(repository_id, state);
CREATE TRIGGER slopbot_close_attempt_identity_immutable
 BEFORE UPDATE ON slopbot_close_attempts
 WHEN NEW.attempt_id != OLD.attempt_id OR NEW.review_key != OLD.review_key OR NEW.repository_id != OLD.repository_id
   OR NEW.project_id != OLD.project_id OR NEW.item_node_id != OLD.item_node_id
   OR NEW.author_id != OLD.author_id OR NEW.revision != OLD.revision
   OR NEW.recovery_json != OLD.recovery_json OR NEW.penalty_eligible != OLD.penalty_eligible
   OR NEW.created_at != OLD.created_at
   OR NEW.comment_confirmed < OLD.comment_confirmed
   OR (OLD.state IN ('confirmed','rejected') AND
       (NEW.state != OLD.state OR NEW.closed_at IS NOT OLD.closed_at OR NEW.rejected_at IS NOT OLD.rejected_at))
 BEGIN SELECT RAISE(ABORT, 'close attempt history is immutable'); END;
CREATE TRIGGER slopbot_close_attempt_no_delete BEFORE DELETE ON slopbot_close_attempts
 BEGIN SELECT RAISE(ABORT, 'close attempt history is append-only'); END;

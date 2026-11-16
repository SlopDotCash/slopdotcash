-- An uncertain Slopbot finding goes to the maintainer first (PRD section 5).
-- If no maintainer acts within 7 days, Slopbot adds its label only. A hold
-- never authorizes a closure. Identifiers only; no verdict or source text.
CREATE TABLE slopbot_maintainer_holds (
 review_key TEXT PRIMARY KEY REFERENCES slopbot_reviews(review_key),
 job_json TEXT NOT NULL CHECK(json_valid(job_json)),
 item_node_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 category TEXT NOT NULL,
 held_at TEXT NOT NULL,
 due_at TEXT NOT NULL CHECK(due_at > held_at),
 queued_at TEXT,
 resolved_at TEXT,
 outcome TEXT CHECK(outcome IS NULL OR outcome IN ('labeled','maintainer_acted','superseded')),
 CHECK((resolved_at IS NULL) = (outcome IS NULL))
) STRICT;
CREATE INDEX slopbot_maintainer_holds_due ON slopbot_maintainer_holds(resolved_at, due_at);
CREATE TRIGGER slopbot_maintainer_holds_fixed BEFORE UPDATE ON slopbot_maintainer_holds
WHEN NEW.review_key != OLD.review_key OR NEW.job_json != OLD.job_json
 OR NEW.item_node_id != OLD.item_node_id OR NEW.revision != OLD.revision
 OR NEW.category != OLD.category OR NEW.held_at != OLD.held_at OR NEW.due_at != OLD.due_at
 OR OLD.resolved_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'maintainer holds resolve once and are otherwise immutable'); END;
CREATE TRIGGER slopbot_maintainer_holds_no_delete BEFORE DELETE ON slopbot_maintainer_holds
BEGIN SELECT RAISE(ABORT,'maintainer holds are append-only'); END;

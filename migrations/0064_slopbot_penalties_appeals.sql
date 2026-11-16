-- Owner decisions D7 and D8 (PRD section 11). Identifiers, integers and
-- outcomes only; no verdict, source, prompt or model text.
--
-- slopbot_penalties: the debit from the one published penalty table. One row
-- per pull request, recorded only after a confirmed close of a
-- closure-eligible author. A row reverses once and is otherwise immutable.
CREATE TABLE slopbot_penalties (
 item_node_id TEXT PRIMARY KEY,
 repository_id INTEGER NOT NULL,
 project_id TEXT NOT NULL,
 author_github_id TEXT NOT NULL CHECK(author_github_id GLOB '[1-9]*' AND author_github_id NOT GLOB '*[^0-9]*'),
 category TEXT NOT NULL,
 table_version TEXT NOT NULL,
 debit_thirds INTEGER NOT NULL CHECK(debit_thirds > 0),
 period TEXT NOT NULL CHECK(period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
 moderator_review INTEGER NOT NULL CHECK(moderator_review IN (0,1)),
 review_key TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 reversed_at TEXT,
 reversal TEXT CHECK(reversal IS NULL OR reversal IN ('appeal_upheld','maintainer_reopen')),
 CHECK((reversed_at IS NULL) = (reversal IS NULL))
) STRICT;
CREATE INDEX slopbot_penalties_author ON slopbot_penalties(author_github_id, period);
CREATE TRIGGER slopbot_penalties_reverse_once BEFORE UPDATE ON slopbot_penalties
WHEN NEW.item_node_id != OLD.item_node_id OR NEW.repository_id != OLD.repository_id
 OR NEW.project_id != OLD.project_id OR NEW.author_github_id != OLD.author_github_id
 OR NEW.category != OLD.category OR NEW.table_version != OLD.table_version
 OR NEW.debit_thirds != OLD.debit_thirds OR NEW.period != OLD.period
 OR NEW.moderator_review != OLD.moderator_review OR NEW.review_key != OLD.review_key
 OR NEW.recorded_at != OLD.recorded_at OR OLD.reversed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'penalties reverse once and are otherwise immutable'); END;
CREATE TRIGGER slopbot_penalties_no_delete BEFORE DELETE ON slopbot_penalties
BEGIN SELECT RAISE(ABORT,'penalties are append-only'); END;

-- slopbot_appeals: one appeal per item revision. Slopbot stores its draft
-- once, escalates once and resolves once.
CREATE TABLE slopbot_appeals (
 appeal_key TEXT PRIMARY KEY,
 repository_id INTEGER NOT NULL,
 item_node_id TEXT NOT NULL,
 appellant_github_id TEXT NOT NULL CHECK(appellant_github_id GLOB '[1-9]*' AND appellant_github_id NOT GLOB '*[^0-9]*'),
 job_json TEXT NOT NULL CHECK(json_valid(job_json)),
 opened_at TEXT NOT NULL,
 due_at TEXT NOT NULL CHECK(due_at > opened_at),
 draft TEXT CHECK(draft IS NULL OR draft IN ('uphold','deny')),
 draft_confidence REAL CHECK(draft_confidence IS NULL OR (draft_confidence >= 0 AND draft_confidence <= 1)),
 drafted_at TEXT,
 escalated_at TEXT,
 escalation TEXT,
 queued_at TEXT,
 resolved_at TEXT,
 resolution TEXT CHECK(resolution IS NULL OR resolution IN ('upheld','denied')),
 resolved_by TEXT CHECK(resolved_by IS NULL OR resolved_by IN ('appellant','maintainer','moderator')),
 CHECK((draft IS NULL) = (drafted_at IS NULL) AND (draft IS NULL) = (draft_confidence IS NULL)),
 CHECK((escalated_at IS NULL) = (escalation IS NULL)),
 CHECK((resolved_at IS NULL) = (resolution IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL))
) STRICT;
CREATE INDEX slopbot_appeals_item ON slopbot_appeals(item_node_id, resolved_at);
CREATE INDEX slopbot_appeals_due ON slopbot_appeals(resolved_at, escalated_at, due_at);
CREATE TRIGGER slopbot_appeals_set_once BEFORE UPDATE ON slopbot_appeals
WHEN NEW.appeal_key != OLD.appeal_key OR NEW.repository_id != OLD.repository_id
 OR NEW.item_node_id != OLD.item_node_id OR NEW.appellant_github_id != OLD.appellant_github_id
 OR NEW.job_json != OLD.job_json OR NEW.opened_at != OLD.opened_at OR NEW.due_at != OLD.due_at
 OR (OLD.draft IS NOT NULL AND (NEW.draft IS NOT OLD.draft OR NEW.draft_confidence IS NOT OLD.draft_confidence OR NEW.drafted_at IS NOT OLD.drafted_at))
 OR (OLD.escalated_at IS NOT NULL AND (NEW.escalated_at IS NOT OLD.escalated_at OR NEW.escalation IS NOT OLD.escalation))
 OR OLD.resolved_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'appeal drafts, escalations and resolutions are set once'); END;
CREATE TRIGGER slopbot_appeals_no_delete BEFORE DELETE ON slopbot_appeals
BEGIN SELECT RAISE(ABORT,'appeals are append-only'); END;

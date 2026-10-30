-- PRD section 7: non-PR/manual Points disputes retain their exact source.
-- The state matches Slopbot appeals without fabricating a GitHub repository.
CREATE TABLE points_disputes (
  appeal_key TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES points_revisions(id),
  item_node_id TEXT NOT NULL CHECK(item_node_id = revision_id),
  appellant_github_id TEXT NOT NULL CHECK(appellant_github_id GLOB '[1-9]*' AND appellant_github_id NOT GLOB '*[^0-9]*'),
  statement TEXT NOT NULL CHECK(length(statement) BETWEEN 1 AND 4000),
  opened_at TEXT NOT NULL,
  due_at TEXT NOT NULL CHECK(due_at > opened_at),
  draft TEXT CHECK(draft IS NULL OR draft IN ('uphold','deny')),
  draft_confidence REAL CHECK(draft_confidence IS NULL OR (draft_confidence >= 0 AND draft_confidence <= 1)),
  drafted_at TEXT,
  escalated_at TEXT,
  escalation TEXT,
  resolved_at TEXT,
  resolution TEXT CHECK(resolution IS NULL OR resolution IN ('upheld','denied')),
  resolved_by TEXT CHECK(resolved_by IS NULL OR resolved_by IN ('appellant','maintainer','moderator')),
  resolution_reason TEXT CHECK(resolution_reason IS NULL OR length(resolution_reason) BETWEEN 1 AND 4000),
  resolver_github_id TEXT CHECK(resolver_github_id IS NULL OR (resolver_github_id GLOB '[1-9]*' AND resolver_github_id NOT GLOB '*[^0-9]*')),
  claim_token TEXT,
  claim_until TEXT,
  CHECK((claim_token IS NULL) = (claim_until IS NULL)),
  CHECK((draft IS NULL) = (drafted_at IS NULL) AND (draft IS NULL) = (draft_confidence IS NULL)),
  CHECK((escalated_at IS NULL) = (escalation IS NULL)),
  CHECK((resolved_at IS NULL) = (resolution IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL)),
  CHECK((resolved_at IS NULL) = (resolution_reason IS NULL) AND (resolved_at IS NULL) = (resolver_github_id IS NULL))
) STRICT;
CREATE INDEX points_disputes_pending ON points_disputes(resolved_at, escalated_at, due_at);
CREATE INDEX points_disputes_actor ON points_disputes(appellant_github_id, opened_at);
CREATE TRIGGER points_dispute_identity_immutable BEFORE UPDATE ON points_disputes
WHEN NEW.appeal_key IS NOT OLD.appeal_key OR NEW.revision_id IS NOT OLD.revision_id
  OR NEW.item_node_id IS NOT OLD.item_node_id OR NEW.appellant_github_id IS NOT OLD.appellant_github_id
  OR NEW.statement IS NOT OLD.statement OR NEW.opened_at IS NOT OLD.opened_at OR NEW.due_at IS NOT OLD.due_at
  OR (OLD.draft IS NOT NULL AND (NEW.draft IS NOT OLD.draft OR NEW.draft_confidence IS NOT OLD.draft_confidence OR NEW.drafted_at IS NOT OLD.drafted_at))
  OR (OLD.escalated_at IS NOT NULL AND (NEW.escalated_at IS NOT OLD.escalated_at OR NEW.escalation IS NOT OLD.escalation))
  OR OLD.resolved_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Points dispute source and decision are immutable'); END;
CREATE TRIGGER points_dispute_no_delete BEFORE DELETE ON points_disputes
BEGIN SELECT RAISE(ABORT, 'Points disputes are permanent'); END;

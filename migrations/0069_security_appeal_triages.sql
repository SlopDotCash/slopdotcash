-- PRD section 8: Slopbot triages disputes first; moderators decide escalated
-- disputes. Each attempt drafts one resolution of one private-case appeal.
-- The draft is advice only. A private security case always escalates to a
-- moderator (recorded owner decision on escalation criteria), so the
-- escalation reasons are recorded with the draft. Attempts are permanent and
-- finish once, like security_case_analyses.
CREATE TABLE security_appeal_triages (
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  -- The case revision of the appeal event this attempt drafts for.
  appeal_revision INTEGER NOT NULL CHECK (appeal_revision > 0),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  state TEXT NOT NULL CHECK (state IN ('running', 'complete', 'failed', 'unavailable')),
  prompt_revision TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  proposed_outcome TEXT CHECK (proposed_outcome IS NULL OR proposed_outcome IN ('uphold', 'return')),
  rationale TEXT CHECK (rationale IS NULL OR length(rationale) BETWEEN 1 AND 4000),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  escalation_reasons TEXT CHECK (
    escalation_reasons IS NULL OR (
      json_valid(escalation_reasons) AND json_type(escalation_reasons) = 'array'
    )
  ),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (case_id, appeal_revision, attempt),
  CHECK (
    (state = 'complete') = (
      proposed_outcome IS NOT NULL AND rationale IS NOT NULL AND
      confidence IS NOT NULL AND escalation_reasons IS NOT NULL AND
      finished_at IS NOT NULL
    )
  )
) STRICT;

CREATE TRIGGER security_appeal_triages_no_delete
BEFORE DELETE ON security_appeal_triages
BEGIN
  SELECT RAISE(ABORT, 'security appeal triages are permanent');
END;

-- Only a running attempt may finish, once.
CREATE TRIGGER security_appeal_triages_finish_once
BEFORE UPDATE ON security_appeal_triages
WHEN OLD.state <> 'running' OR NEW.case_id IS NOT OLD.case_id OR
  NEW.appeal_revision IS NOT OLD.appeal_revision OR
  NEW.attempt IS NOT OLD.attempt OR NEW.started_at IS NOT OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'a finished appeal triage is immutable');
END;

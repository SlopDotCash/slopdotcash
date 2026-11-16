-- Automatic private report intake, AI case analysis and discretionary awards
-- (PRD section 8 "Report and decide privately", section 10 Intake, Capacity
-- and Amounts; MVP-13; issue #910).
--
-- Receipt: Slop reads the program repository's GitHub private vulnerability
-- reports and records each one under the GitHub account that GitHub says
-- submitted it, at GitHub's own creation time. Older receipts keep their
-- maintainer-attested time. `verified_by_github_id = 'github'` marks a
-- receipt that Slop verified from GitHub rather than a person.
-- The gross award the owner chose. It is reserved when the award is approved
-- (or when an independent reviewer approves a related-party award). Older
-- awards keep the program amount frozen in `terms`; NULL means none chosen.
ALTER TABLE security_cases ADD COLUMN award_gross_minor TEXT CHECK (
  award_gross_minor IS NULL OR (
    length(award_gross_minor) BETWEEN 1 AND 16 AND
    award_gross_minor GLOB '[1-9]*' AND award_gross_minor NOT GLOB '*[^0-9]*'
  )
);

-- A chosen amount never changes once its reservation exists.
CREATE TRIGGER security_cases_award_amount_fixed
BEFORE UPDATE ON security_cases
WHEN OLD.award_gross_minor IS NOT NULL AND
  NEW.award_gross_minor IS NOT OLD.award_gross_minor AND
  EXISTS (SELECT 1 FROM security_award_reservations WHERE case_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'a reserved award amount is immutable');
END;

-- Automatic private analysis of a verified report. It stores only the model's
-- proposal and the digest of the advisory text it read, never the report.
-- A proposal never decides a case or an award.
CREATE TABLE security_case_analyses (
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  state TEXT NOT NULL CHECK (state IN ('running', 'complete', 'failed', 'unavailable')),
  prompt_revision TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  advisory_digest TEXT CHECK (advisory_digest IS NULL OR length(advisory_digest) = 64),
  summary TEXT CHECK (summary IS NULL OR length(summary) BETWEEN 1 AND 4000),
  proposed_severity TEXT CHECK (proposed_severity IS NULL OR proposed_severity IN (
    'critical', 'high', 'medium', 'low', 'informational', 'unresolved'
  )),
  potential_loss TEXT CHECK (potential_loss IS NULL OR potential_loss IN ('likely', 'unlikely', 'unclear')),
  duplicate_case_ids TEXT CHECK (duplicate_case_ids IS NULL OR json_valid(duplicate_case_ids)),
  root_cause_key TEXT CHECK (root_cause_key IS NULL OR length(root_cause_key) BETWEEN 3 AND 80),
  remediation TEXT CHECK (remediation IS NULL OR length(remediation) BETWEEN 1 AND 4000),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (case_id, attempt),
  CHECK ((state = 'complete') = (summary IS NOT NULL AND finished_at IS NOT NULL))
) STRICT;

CREATE TRIGGER security_case_analyses_no_delete
BEFORE DELETE ON security_case_analyses
BEGIN
  SELECT RAISE(ABORT, 'security case analyses are permanent');
END;

-- Only a running attempt may finish, once.
CREATE TRIGGER security_case_analyses_finish_once
BEFORE UPDATE ON security_case_analyses
WHEN OLD.state <> 'running' OR NEW.case_id IS NOT OLD.case_id OR
  NEW.attempt IS NOT OLD.attempt OR NEW.started_at IS NOT OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'a finished analysis is immutable');
END;

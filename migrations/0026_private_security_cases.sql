-- Restricted private security bounty cases (PRD SEC-07 to SEC-14, MVP-13).
-- Program terms live in the project's manifest revision. These tables hold
-- only case metadata, human decisions and award reservations. No public
-- route, build, leaderboard, cycle or export reads them. The GitHub private
-- advisory keeps the technical report; Slop stores only its reference.

CREATE TABLE security_cases (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sc_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL REFERENCES projects(id),
  advisory_repository TEXT NOT NULL CHECK (length(advisory_repository) BETWEEN 3 AND 201),
  -- D1 limits GLOB pattern length; the API checks the GHSA alphabet.
  advisory_ghsa TEXT NOT NULL CHECK (
    length(advisory_ghsa) = 19 AND advisory_ghsa GLOB 'GHSA-????-????-????'
  ),
  reporter_github_id TEXT NOT NULL CHECK (reporter_github_id GLOB '[1-9]*'),
  reporter_github_login TEXT NOT NULL,
  -- A reporter's link is a claim until a security maintainer confirms the
  -- GitHub advisory exists and names this reporter (SEC-07, SEC-17).
  submission_state TEXT NOT NULL CHECK (submission_state IN ('claimed', 'verified', 'link-rejected')),
  received_at TEXT,
  verified_at TEXT,
  verified_by_github_id TEXT,
  -- Frozen at receipt: the project revision in force at received_at, and the
  -- program's gross amount, currency and exact split (SEC-05). NULL terms
  -- mean no paid program was open at receipt; the case stays private anyway.
  policy_revision INTEGER,
  terms TEXT CHECK (terms IS NULL OR json_valid(terms)),
  evidence_digest TEXT CHECK (evidence_digest IS NULL OR length(evidence_digest) = 64),
  receipt_state TEXT NOT NULL CHECK (receipt_state IN (
    'received', 'needs-information', 'triaging', 'confirmed', 'duplicate',
    'out-of-scope', 'rejected', 'disputed'
  )),
  remediation_state TEXT NOT NULL CHECK (remediation_state IN (
    'not-started', 'investigating', 'fixing', 'retest', 'resolved',
    'mitigation-verified', 'reopened'
  )),
  award_state TEXT NOT NULL CHECK (award_state IN (
    'not-applicable', 'pending', 'ineligible', 'reserved',
    'capacity-exhausted', 'approved'
  )),
  -- No private settlement rail is approved, so an approved award waits with
  -- an explicit unavailable rail. Nothing here can become paid.
  payment_state TEXT NOT NULL CHECK (payment_state IN ('not-applicable', 'rail-unavailable')),
  disclosure_state TEXT NOT NULL CHECK (disclosure_state IN ('embargoed', 'redaction-approved', 'disclosed')),
  recognition TEXT NOT NULL CHECK (recognition IN ('private', 'opt-in')),
  severity TEXT CHECK (severity IS NULL OR severity IN (
    'critical', 'high', 'medium', 'low', 'informational', 'unresolved'
  )),
  loss_finding TEXT CHECK (loss_finding IS NULL OR loss_finding IN (
    'verified-potential', 'verified-actual', 'not-verified', 'unresolved'
  )),
  root_cause_key TEXT CHECK (root_cause_key IS NULL OR length(root_cause_key) BETWEEN 3 AND 80),
  duplicate_of TEXT REFERENCES security_cases(id),
  technical_decider_github_id TEXT,
  appeal_state TEXT NOT NULL CHECK (appeal_state IN ('none', 'open', 'upheld', 'returned')),
  appeal_from_state TEXT,
  owner_github_id TEXT,
  next_action TEXT CHECK (next_action IS NULL OR length(next_action) BETWEEN 1 AND 500),
  next_action_due_at TEXT,
  payment_deadline TEXT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (submission_state = 'verified' AND received_at IS NOT NULL AND
      verified_at IS NOT NULL AND verified_by_github_id IS NOT NULL) OR
    (submission_state <> 'verified' AND policy_revision IS NULL AND terms IS NULL)
  ),
  CHECK (award_state NOT IN ('reserved', 'approved') OR terms IS NOT NULL),
  CHECK (payment_state = 'not-applicable' OR award_state = 'approved')
) STRICT;

-- One verified case per advisory; several unverified claims may compete.
CREATE UNIQUE INDEX security_cases_one_verified_advisory
  ON security_cases(project_id, advisory_ghsa) WHERE submission_state = 'verified';
-- One live case per reporter and advisory. A rejected link stays as history
-- and does not block a corrected claim or a maintainer record (SEC-07).
CREATE UNIQUE INDEX security_cases_one_claim_per_reporter
  ON security_cases(project_id, advisory_ghsa, reporter_github_id)
  WHERE submission_state <> 'link-rejected';
CREATE INDEX security_cases_reporter ON security_cases(reporter_github_id);
CREATE INDEX security_cases_project ON security_cases(project_id, created_at);

CREATE TRIGGER security_cases_no_delete
BEFORE DELETE ON security_cases
BEGIN
  SELECT RAISE(ABORT, 'security cases are permanent');
END;

-- Original receipt time and frozen policy never change once verified.
CREATE TRIGGER security_cases_frozen_receipt
BEFORE UPDATE ON security_cases
WHEN OLD.submission_state = 'verified' AND (
  NEW.received_at IS NOT OLD.received_at OR
  NEW.policy_revision IS NOT OLD.policy_revision OR
  NEW.terms IS NOT OLD.terms OR
  NEW.reporter_github_id IS NOT OLD.reporter_github_id OR
  NEW.advisory_ghsa IS NOT OLD.advisory_ghsa OR
  NEW.submission_state <> 'verified'
)
BEGIN
  SELECT RAISE(ABORT, 'a verified receipt is immutable');
END;

-- Every change appends one event bound to the case revision it produced.
-- The primary key makes a second write from the same prior revision fail.
CREATE TABLE security_case_events (
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  case_revision INTEGER NOT NULL CHECK (case_revision > 0),
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 3 AND 40),
  actor_github_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN (
    'reporter', 'security-maintainer', 'triager', 'financial', 'dispute'
  )),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 80),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 2000),
  evidence_reference TEXT CHECK (evidence_reference IS NULL OR length(evidence_reference) BETWEEN 1 AND 500),
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  at TEXT NOT NULL,
  PRIMARY KEY (case_id, case_revision),
  UNIQUE (case_id, idempotency_key)
) STRICT;

CREATE TRIGGER security_case_events_no_update
BEFORE UPDATE ON security_case_events
BEGIN
  SELECT RAISE(ABORT, 'security case events are immutable');
END;

CREATE TRIGGER security_case_events_no_delete
BEFORE DELETE ON security_case_events
BEGIN
  SELECT RAISE(ABORT, 'security case events are permanent');
END;

-- Triagers see only the cases they are assigned to. Revocation is a new row
-- state, never a delete, so membership history stays auditable.
CREATE TABLE security_case_members (
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  github_id TEXT NOT NULL CHECK (github_id GLOB '[1-9]*'),
  github_login TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'triager'),
  added_by_github_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by_github_id TEXT,
  PRIMARY KEY (case_id, github_id, added_at),
  CHECK ((revoked_at IS NULL) = (revoked_by_github_id IS NULL))
) STRICT;

CREATE UNIQUE INDEX security_case_members_one_active
  ON security_case_members(case_id, github_id) WHERE revoked_at IS NULL;

CREATE TRIGGER security_case_members_no_delete
BEFORE DELETE ON security_case_members
BEGIN
  SELECT RAISE(ABORT, 'security case membership history is permanent');
END;

-- A reserved gross award. One root cause reserves once per project, and an
-- accepted obligation is never released by a later policy or appeal.
CREATE TABLE security_award_reservations (
  case_id TEXT PRIMARY KEY REFERENCES security_cases(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  root_cause_key TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  gross_minor TEXT NOT NULL CHECK (gross_minor GLOB '[1-9]*'),
  currency TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  UNIQUE (project_id, root_cause_key)
) STRICT;

CREATE TRIGGER security_award_reservations_no_update
BEFORE UPDATE ON security_award_reservations
BEGIN
  SELECT RAISE(ABORT, 'award reservations are immutable');
END;

CREATE TRIGGER security_award_reservations_no_delete
BEFORE DELETE ON security_award_reservations
BEGIN
  SELECT RAISE(ABORT, 'award reservations are permanent');
END;

-- Slop reads of a case, by whom and in which role. Never the case content.
CREATE TABLE security_case_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  actor_github_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write')),
  at TEXT NOT NULL
) STRICT;

CREATE INDEX security_case_access_log_case ON security_case_access_log(case_id, at);

CREATE TRIGGER security_case_access_log_no_update
BEFORE UPDATE ON security_case_access_log
BEGIN
  SELECT RAISE(ABORT, 'access log entries are immutable');
END;

CREATE TRIGGER security_case_access_log_no_delete
BEFORE DELETE ON security_case_access_log
BEGIN
  SELECT RAISE(ABORT, 'access log entries are permanent');
END;

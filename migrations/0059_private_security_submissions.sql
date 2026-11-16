-- Automatic private security intake (PRD section 8 "Private reporting is
-- automatic", SEC-07, SEC-17; issue #910). A reporter's report goes to
-- GitHub private vulnerability reporting with the reporter's own
-- authorization. Slop keeps only the submission state machine here: no
-- summary, description, proof of concept, severity text, error body or
-- token. A security case still exists only after GitHub receipt is verified.
-- Everything stays unreachable while SLOP_PRIVATE_INTAKE_MODE is off.

CREATE TABLE security_submissions (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ss_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- From the program terms at creation, never from the request.
  repository TEXT NOT NULL CHECK (length(repository) BETWEEN 3 AND 201),
  reporter_github_id TEXT NOT NULL CHECK (reporter_github_id GLOB '[1-9]*'),
  reporter_github_login TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('slop', 'direct')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 80),
  -- Random hex embedded in the private GitHub description; finds an
  -- uncertain submission again without a second POST.
  marker TEXT NOT NULL CHECK (length(marker) = 32 AND marker NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN (
    'draft', 'submitting', 'uncertain', 'submitted', 'receipt-verified',
    'failed', 'abandoned'
  )),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  attempt_started_at TEXT,
  advisory_ghsa TEXT CHECK (advisory_ghsa IS NULL OR (
    length(advisory_ghsa) = 19 AND advisory_ghsa GLOB 'GHSA-????-????-????'
  )),
  github_created_at TEXT,
  evidence_digest TEXT CHECK (evidence_digest IS NULL OR length(evidence_digest) = 64),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN (
    'pvr-disabled', 'app-not-installed', 'forbidden', 'invalid',
    'author-mismatch', 'not-found', 'grant-expired', 'already-recorded',
    'not-private-report', 'unverifiable'
  )),
  case_id TEXT REFERENCES security_cases(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state <> 'receipt-verified' OR (
    advisory_ghsa IS NOT NULL AND case_id IS NOT NULL AND github_created_at IS NOT NULL
  )),
  CHECK (state <> 'submitted' OR advisory_ghsa IS NOT NULL),
  CHECK (state <> 'submitting' OR attempt_started_at IS NOT NULL),
  CHECK ((state = 'failed') = (failure_code IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX security_submissions_idem
  ON security_submissions(reporter_github_id, idempotency_key);
-- One submission holds a GitHub advisory once it is adopted or verified. A
-- direct draft naming someone else's advisory cannot block its author.
CREATE UNIQUE INDEX security_submissions_ghsa
  ON security_submissions(repository, advisory_ghsa)
  WHERE state IN ('submitted', 'receipt-verified');
-- At most one send in flight per reporter and project.
CREATE UNIQUE INDEX security_submissions_one_live
  ON security_submissions(project_id, reporter_github_id)
  WHERE state IN ('submitting', 'uncertain');
CREATE INDEX security_submissions_reporter
  ON security_submissions(reporter_github_id, created_at);

CREATE TRIGGER security_submissions_no_delete
BEFORE DELETE ON security_submissions
BEGIN
  SELECT RAISE(ABORT, 'security submissions are permanent');
END;

-- Identity, binding and terminal states never change.
CREATE TRIGGER security_submissions_frozen
BEFORE UPDATE ON security_submissions
WHEN NEW.id IS NOT OLD.id OR
  NEW.project_id IS NOT OLD.project_id OR
  NEW.repository IS NOT OLD.repository OR
  NEW.reporter_github_id IS NOT OLD.reporter_github_id OR
  NEW.origin IS NOT OLD.origin OR
  NEW.idempotency_key IS NOT OLD.idempotency_key OR
  NEW.marker IS NOT OLD.marker OR
  NEW.created_at IS NOT OLD.created_at OR
  NEW.revision <> OLD.revision + 1 OR
  NEW.attempt < OLD.attempt OR
  OLD.state IN ('receipt-verified', 'abandoned') OR
  (OLD.advisory_ghsa IS NOT NULL AND NEW.advisory_ghsa IS NOT OLD.advisory_ghsa)
BEGIN
  SELECT RAISE(ABORT, 'a security submission binding is immutable');
END;

-- Insert-only history: enum kinds and identifiers, never report content.
CREATE TABLE security_submission_events (
  submission_id TEXT NOT NULL REFERENCES security_submissions(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 3 AND 40),
  detail TEXT CHECK (detail IS NULL OR json_valid(detail)),
  actor_github_id TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (submission_id, revision)
) STRICT;

CREATE TRIGGER security_submission_events_no_update
BEFORE UPDATE ON security_submission_events
BEGIN
  SELECT RAISE(ABORT, 'security submission events are immutable');
END;

CREATE TRIGGER security_submission_events_no_delete
BEFORE DELETE ON security_submission_events
BEGIN
  SELECT RAISE(ABORT, 'security submission events are permanent');
END;

-- Where the receipt time came from. NULL on older verified cases reads as
-- 'maintainer-attested'. The GitHub evidence digest is kept apart from the
-- decision-evidence digest that the technical decision records later.
ALTER TABLE security_cases ADD COLUMN received_at_source TEXT
  CHECK (received_at_source IS NULL OR received_at_source IN ('maintainer-attested', 'github-verified'));
ALTER TABLE security_cases ADD COLUMN receipt_evidence_digest TEXT
  CHECK (receipt_evidence_digest IS NULL OR length(receipt_evidence_digest) = 64);

DROP TRIGGER security_cases_frozen_receipt;

-- Original receipt time, its source and evidence, and the frozen policy
-- never change once verified.
CREATE TRIGGER security_cases_frozen_receipt
BEFORE UPDATE ON security_cases
WHEN OLD.submission_state = 'verified' AND (
  NEW.received_at IS NOT OLD.received_at OR
  NEW.received_at_source IS NOT OLD.received_at_source OR
  NEW.receipt_evidence_digest IS NOT OLD.receipt_evidence_digest OR
  NEW.policy_revision IS NOT OLD.policy_revision OR
  NEW.terms IS NOT OLD.terms OR
  NEW.reporter_github_id IS NOT OLD.reporter_github_id OR
  NEW.advisory_ghsa IS NOT OLD.advisory_ghsa OR
  NEW.submission_state <> 'verified'
)
BEGIN
  SELECT RAISE(ABORT, 'a verified receipt is immutable');
END;

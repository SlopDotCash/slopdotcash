-- PRD section 8: durable Slop receipts precede screening and optional GitHub delivery.
-- Preserve every existing receipt, event and funded obligation. Rebuild under the
-- same table name so D1 deferred child references resolve (see migration 0017).
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;
CREATE TABLE security_cases_0101_copy AS SELECT * FROM security_cases;
DROP TRIGGER security_cases_no_delete;
DROP TRIGGER security_cases_frozen_receipt;
DROP TRIGGER security_cases_award_amount_fixed;
DROP TABLE security_cases;
CREATE TABLE security_cases (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sc_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL REFERENCES projects(id),
  advisory_repository TEXT NOT NULL CHECK (length(advisory_repository) BETWEEN 3 AND 201),
  -- D1 limits GLOB pattern length; the API checks the GHSA alphabet.
  advisory_ghsa TEXT CHECK (
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
  -- Case status is independent of the private settlement tables, which
  -- record finalized payment evidence without exposing it to public totals.
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
  updated_at TEXT NOT NULL, related_party TEXT NOT NULL
  DEFAULT 'not-assessed'
  CHECK (related_party IN ('not-assessed', 'unrelated', 'related')), related_party_review TEXT NOT NULL
  DEFAULT 'not-applicable'
  CHECK (related_party_review IN ('not-applicable', 'pending', 'approved', 'refused')), related_party_reviewer_github_id TEXT, received_at_source TEXT
  CHECK (received_at_source IS NULL OR received_at_source IN ('maintainer-attested', 'github-verified', 'slop-received')), receipt_evidence_digest TEXT
  CHECK (receipt_evidence_digest IS NULL OR length(receipt_evidence_digest) = 64), award_gross_minor TEXT CHECK (
  award_gross_minor IS NULL OR (
    length(award_gross_minor) BETWEEN 1 AND 16 AND
    award_gross_minor GLOB '[1-9]*' AND award_gross_minor NOT GLOB '*[^0-9]*'
  )
),
  CHECK (
    (submission_state = 'verified' AND received_at IS NOT NULL AND
      verified_at IS NOT NULL AND verified_by_github_id IS NOT NULL) OR
    (submission_state <> 'verified' AND policy_revision IS NULL AND terms IS NULL)
  ),
  CHECK (award_state NOT IN ('reserved', 'approved') OR terms IS NOT NULL),
  CHECK (payment_state = 'not-applicable' OR award_state = 'approved')
) STRICT;
INSERT INTO security_cases SELECT * FROM security_cases_0101_copy;
DROP TABLE security_cases_0101_copy;
CREATE UNIQUE INDEX security_cases_one_verified_advisory
  ON security_cases(project_id, advisory_ghsa) WHERE submission_state = 'verified';
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
CREATE TRIGGER security_cases_award_amount_fixed
BEFORE UPDATE ON security_cases
WHEN OLD.award_gross_minor IS NOT NULL AND
  NEW.award_gross_minor IS NOT OLD.award_gross_minor AND
  EXISTS (SELECT 1 FROM security_award_reservations WHERE case_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'a reserved award amount is immutable');
END;

-- One durable intake accompanies the existing submission and case identities.
CREATE TABLE security_submission_intake (
 submission_id TEXT PRIMARY KEY REFERENCES security_submissions(id),
 case_id TEXT NOT NULL UNIQUE REFERENCES security_cases(id),
 received_at TEXT NOT NULL,
 report_version INTEGER NOT NULL DEFAULT 1 CHECK(report_version > 0),
 screening_state TEXT NOT NULL CHECK(screening_state IN ('queued','running','legitimate','needs-information','spam','unavailable')),
 screening_started_at TEXT,
 screening_finished_at TEXT,
 screening_reason TEXT CHECK(screening_reason IS NULL OR length(screening_reason) BETWEEN 1 AND 2000),
 routed_at TEXT,
 screening_provider TEXT,
 screening_model TEXT,
 reviewed_at TEXT,
 reviewed_by TEXT,
 review_decision TEXT CHECK(review_decision IS NULL OR review_decision IN ('forward','request-information')),
 review_reason TEXT CHECK(review_reason IS NULL OR length(review_reason) BETWEEN 1 AND 2000),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 CHECK((review_decision IS NULL) = (reviewed_at IS NULL)),
 CHECK((review_decision IS NULL) = (reviewed_by IS NULL))
) STRICT;
CREATE TABLE security_intake_reports (
 submission_id TEXT NOT NULL REFERENCES security_submissions(id),
 version INTEGER NOT NULL CHECK(version > 0),
 object_key TEXT NOT NULL UNIQUE,
 content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
 byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 1 AND 262144),
 created_at TEXT NOT NULL,
 PRIMARY KEY(submission_id,version)
) STRICT;
CREATE TABLE security_intake_events (
 submission_id TEXT NOT NULL REFERENCES security_submissions(id),
 revision INTEGER NOT NULL,
 kind TEXT NOT NULL,
 actor_github_id TEXT,
 at TEXT NOT NULL,
 PRIMARY KEY(submission_id,revision)
) STRICT;
CREATE TABLE security_intake_access_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 submission_id TEXT NOT NULL REFERENCES security_submissions(id),
 actor_github_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('read','write')),
 at TEXT NOT NULL
) STRICT;
CREATE TRIGGER security_intake_frozen BEFORE UPDATE ON security_submission_intake
WHEN NEW.submission_id IS NOT OLD.submission_id OR NEW.case_id IS NOT OLD.case_id
 OR NEW.received_at IS NOT OLD.received_at OR NEW.revision <> OLD.revision + 1
 OR NEW.report_version NOT IN (OLD.report_version, OLD.report_version + 1)
BEGIN SELECT RAISE(ABORT,'security intake receipt is immutable'); END;
CREATE TRIGGER security_intake_no_delete BEFORE DELETE ON security_submission_intake
BEGIN SELECT RAISE(ABORT,'security intakes are permanent'); END;
CREATE TRIGGER security_intake_report_no_update BEFORE UPDATE ON security_intake_reports
BEGIN SELECT RAISE(ABORT,'security reports are immutable'); END;
CREATE TRIGGER security_intake_report_no_delete BEFORE DELETE ON security_intake_reports
BEGIN SELECT RAISE(ABORT,'security reports are permanent'); END;
CREATE TRIGGER security_intake_event_no_update BEFORE UPDATE ON security_intake_events
BEGIN SELECT RAISE(ABORT,'security intake events are immutable'); END;
CREATE TRIGGER security_intake_event_no_delete BEFORE DELETE ON security_intake_events
BEGIN SELECT RAISE(ABORT,'security intake events are permanent'); END;
CREATE TRIGGER security_intake_access_no_update BEFORE UPDATE ON security_intake_access_log
BEGIN SELECT RAISE(ABORT,'security intake access is immutable'); END;
CREATE TRIGGER security_intake_access_no_delete BEFORE DELETE ON security_intake_access_log
BEGIN SELECT RAISE(ABORT,'security intake access is permanent'); END;
PRAGMA foreign_keys = ON;

-- A later manual claim/import cannot duplicate a Slop receipt after its
-- optional GitHub advisory is adopted. The API resolves authorized replays.
CREATE TRIGGER security_cases_existing_intake_advisory
BEFORE INSERT ON security_cases
WHEN NEW.advisory_ghsa IS NOT NULL AND EXISTS (
 SELECT 1 FROM security_submissions s JOIN security_submission_intake i ON i.submission_id=s.id
 WHERE s.project_id=NEW.project_id AND s.repository=NEW.advisory_repository
 AND s.advisory_ghsa=NEW.advisory_ghsa AND s.state IN ('submitted','receipt-verified')
)
BEGIN SELECT RAISE(ABORT,'UNIQUE constraint failed: security_cases.advisory_ghsa'); END;

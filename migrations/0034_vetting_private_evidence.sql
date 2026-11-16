-- Vetting evidence is separate from contributor traces and security cases.
-- Object expiry stops application access; it does not delete R2 or backups.
CREATE TABLE vetting_evidence_runs (
  assessment_id TEXT NOT NULL REFERENCES vetting_assessments(id),
  run_id TEXT NOT NULL,
  trace_sha256 TEXT NOT NULL CHECK(length(trace_sha256)=64),
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
  manifest TEXT NOT NULL CHECK(json_valid(manifest)),
  policy TEXT NOT NULL CHECK(json_valid(policy)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(assessment_id,run_id)
) STRICT;
CREATE TABLE vetting_evidence_objects (
  assessment_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  content_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  PRIMARY KEY(assessment_id,run_id,sha256),
  FOREIGN KEY(assessment_id,run_id) REFERENCES vetting_evidence_runs(assessment_id,run_id)
) STRICT;
CREATE TABLE vetting_evidence_grants (
  token_hash TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  operator_github_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY(assessment_id,run_id,sha256) REFERENCES vetting_evidence_objects(assessment_id,run_id,sha256)
) STRICT;
CREATE TABLE vetting_evidence_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  run_id TEXT,
  sha256 TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER vetting_evidence_runs_no_update BEFORE UPDATE ON vetting_evidence_runs BEGIN SELECT RAISE(ABORT,'immutable evidence manifest'); END;
CREATE TRIGGER vetting_evidence_objects_no_update BEFORE UPDATE ON vetting_evidence_objects BEGIN SELECT RAISE(ABORT,'immutable evidence object'); END;
CREATE TRIGGER vetting_evidence_audit_no_update BEFORE UPDATE ON vetting_evidence_audit BEGIN SELECT RAISE(ABORT,'immutable evidence audit'); END;
CREATE TRIGGER vetting_evidence_audit_no_delete BEFORE DELETE ON vetting_evidence_audit BEGIN SELECT RAISE(ABORT,'immutable evidence audit'); END;

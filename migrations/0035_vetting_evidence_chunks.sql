-- A transport layout does not replace the canonical whole-object digest.
ALTER TABLE vetting_evidence_objects ADD COLUMN chunks TEXT CHECK(chunks IS NULL OR json_valid(chunks));
CREATE TABLE vetting_evidence_completions (
  assessment_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY(assessment_id,run_id,sha256),
  FOREIGN KEY(assessment_id,run_id,sha256) REFERENCES vetting_evidence_objects(assessment_id,run_id,sha256)
) STRICT;
CREATE TRIGGER vetting_evidence_completions_no_update BEFORE UPDATE ON vetting_evidence_completions BEGIN SELECT RAISE(ABORT,'immutable complete evidence'); END;
CREATE TRIGGER vetting_evidence_completions_no_delete BEFORE DELETE ON vetting_evidence_completions BEGIN SELECT RAISE(ABORT,'immutable complete evidence'); END;

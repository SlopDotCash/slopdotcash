-- Closing a scanner case starts the owner's approved 90-day retention clock.
-- A closure never changes the assessment, project restriction or award state.
CREATE TABLE vetting_evidence_case_closures (
  assessment_id TEXT PRIMARY KEY REFERENCES vetting_assessments(id),
  closed_at TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000)
) STRICT;
CREATE TRIGGER vetting_evidence_case_closures_no_update
BEFORE UPDATE ON vetting_evidence_case_closures
BEGIN SELECT RAISE(ABORT, 'case closure is immutable'); END;
CREATE TRIGGER vetting_evidence_case_closures_no_delete
BEFORE DELETE ON vetting_evidence_case_closures
BEGIN SELECT RAISE(ABORT, 'case closure is permanent'); END;
CREATE TRIGGER vetting_clean_case_closure
AFTER UPDATE OF state ON vetting_assessments
WHEN NEW.state = 'clean'
BEGIN
  INSERT INTO vetting_evidence_case_closures(assessment_id,closed_at,closed_by,reason)
  VALUES(NEW.id,NEW.completed_at,'automatic','Clean scan completed');
END;
INSERT INTO vetting_evidence_case_closures(assessment_id,closed_at,closed_by,reason)
SELECT id,completed_at,'automatic','Clean scan completed'
FROM vetting_assessments WHERE state='clean';

-- A retained report revision must never display an older assessment as current.
-- NULL preserves the existing GitHub-only advisory path. Existing assessments
-- remain immutable history; retained reports receive a version-bound attempt.
ALTER TABLE security_case_analyses ADD COLUMN report_version INTEGER
  CHECK (report_version IS NULL OR report_version > 0);

CREATE TRIGGER security_case_analysis_report_version_fixed
BEFORE UPDATE ON security_case_analyses
WHEN NEW.report_version IS NOT OLD.report_version
BEGIN
  SELECT RAISE(ABORT, 'an analysis report version is immutable');
END;

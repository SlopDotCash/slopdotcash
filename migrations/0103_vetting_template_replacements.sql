-- Preserve automatic retry provenance at insertion, independently of editable
-- request reason text. Existing assessments receive no inferred provenance.
ALTER TABLE vetting_assessments ADD COLUMN replaces_assessment_id TEXT
  REFERENCES vetting_assessments(id);
CREATE TRIGGER vetting_replacement_immutable
BEFORE UPDATE OF replaces_assessment_id ON vetting_assessments
WHEN NEW.replaces_assessment_id IS NOT OLD.replaces_assessment_id
BEGIN SELECT RAISE(ABORT, 'vetting replacement provenance is immutable'); END;

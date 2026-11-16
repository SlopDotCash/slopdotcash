-- An independent moderator's appeal decision may clear only the exact
-- malicious findings reviewed with a fresh complete scan. New findings are
-- never waived by an earlier decision. History remains permanent.
CREATE TABLE project_vetting_reinstatements (
  enforcement_id TEXT PRIMARY KEY REFERENCES project_enforcements(id),
  assessment_id TEXT NOT NULL REFERENCES vetting_assessments(id),
  malicious_assessment_ids TEXT NOT NULL CHECK (
    json_valid(malicious_assessment_ids) AND json_type(malicious_assessment_ids) = 'array'
  )
) STRICT;
CREATE TRIGGER project_vetting_reinstatements_valid
BEFORE INSERT ON project_vetting_reinstatements
WHEN NOT EXISTS (
  SELECT 1 FROM project_enforcements e JOIN vetting_assessments a
    ON a.id = NEW.assessment_id AND a.project_id = e.project_id
  WHERE e.id = NEW.enforcement_id AND e.action = 'reinstate'
    AND e.actor_role = 'project-moderator' AND a.state = 'clean'
    AND a.revision = e.before_revision
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.malicious_assessment_ids) reviewed
  WHERE NOT EXISTS (
    SELECT 1 FROM vetting_assessments bad JOIN vetting_assessments clean
      ON clean.id = NEW.assessment_id AND clean.project_id = bad.project_id
    WHERE bad.id = reviewed.value AND bad.state = 'malicious'
      AND clean.requested_at > bad.completed_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'reinstatement needs a clean scan after each reviewed finding');
END;
CREATE TRIGGER project_vetting_reinstatements_no_update
BEFORE UPDATE ON project_vetting_reinstatements
BEGIN
  SELECT RAISE(ABORT, 'vetting reinstatement evidence is immutable');
END;
CREATE TRIGGER project_vetting_reinstatements_no_delete
BEFORE DELETE ON project_vetting_reinstatements
BEGIN
  SELECT RAISE(ABORT, 'vetting reinstatement evidence is permanent');
END;

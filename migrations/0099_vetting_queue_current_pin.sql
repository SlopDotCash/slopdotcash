-- A pending scan of an old commit or template must not block a fresh scan.
-- Enforce duplicate refusal in the database, including during migration
-- rollout before the new application code starts serving requests.
-- Superseded assessments stay unchanged in the permanent audit history.
DROP INDEX vetting_assessments_one_pending;
CREATE INDEX vetting_assessments_project_queue
ON vetting_assessments(project_id);

CREATE TRIGGER vetting_assessments_same_pending
BEFORE INSERT ON vetting_assessments
WHEN NEW.state = 'pending' AND EXISTS (
  SELECT 1 FROM vetting_assessments current
  WHERE current.rowid = (
    SELECT MAX(rowid) FROM vetting_assessments WHERE project_id = NEW.project_id
  ) AND current.state = 'pending' AND current.revision = NEW.revision
    AND current.commit_sha = NEW.commit_sha
    AND current.template_sha256 = NEW.template_sha256
    -- Older application versions do not sort the retained flag IDs.
    AND NOT EXISTS (
      SELECT value FROM json_each(current.flag_ids)
      EXCEPT SELECT value FROM json_each(NEW.flag_ids)
    ) AND NOT EXISTS (
      SELECT value FROM json_each(NEW.flag_ids)
      EXCEPT SELECT value FROM json_each(current.flag_ids)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: vetting_assessments.current_pending');
END;

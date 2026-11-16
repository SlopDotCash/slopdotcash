-- One admission scan per registered repository (PRD section 8: "one complete
-- successful admission scan for each nonexempt immutable registered
-- repository"; "A different repository cannot inherit clearance").
--
-- `repository_id` is the manifest repository `id` the scan covers. New rows
-- always store it, including for a project's first repository. A NULL value
-- exists only on rows written before this migration, or by an older
-- application during rollout, and means the first repository listed by the
-- row's own revision. Every reader resolves it the same way:
--
--   COALESCE(repository_id, json_extract(<the row's project_revisions
--   manifest>, '$.repositories[0].id'))
--
-- Existing rows are not rewritten: assessments are permanent history.

ALTER TABLE vetting_assessments ADD COLUMN repository_id TEXT;

CREATE INDEX vetting_assessments_repository_queue
ON vetting_assessments(project_id, repository_id);

-- A row names a repository that its own revision lists.
CREATE TRIGGER vetting_assessments_listed_repository
BEFORE INSERT ON vetting_assessments
WHEN NEW.repository_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM project_revisions r, json_each(r.manifest, '$.repositories') e
  WHERE r.project_id = NEW.project_id AND r.revision = NEW.revision
    AND json_extract(e.value, '$.id') = NEW.repository_id
)
BEGIN
  SELECT RAISE(ABORT, 'a scan names a repository of its revision');
END;

CREATE TRIGGER vetting_assessments_repository_immutable
BEFORE UPDATE OF repository_id ON vetting_assessments
WHEN NEW.repository_id IS NOT OLD.repository_id
BEGIN
  SELECT RAISE(ABORT, 'the scanned repository is immutable');
END;

-- The queue compares a new pending scan with the latest scan of the same
-- project and repository, not the latest scan of the whole project. A legacy
-- NULL row resolves to the first repository of its revision, so it still
-- refuses a duplicate written with the explicit id.
DROP TRIGGER vetting_assessments_same_pending;
CREATE TRIGGER vetting_assessments_same_pending
BEFORE INSERT ON vetting_assessments
WHEN NEW.state = 'pending' AND EXISTS (
  SELECT 1 FROM vetting_assessments current
  WHERE current.rowid = (
    SELECT MAX(c.rowid) FROM vetting_assessments c
    WHERE c.project_id = NEW.project_id
      AND COALESCE(c.repository_id, (
        SELECT json_extract(r.manifest, '$.repositories[0].id')
        FROM project_revisions r
        WHERE r.project_id = c.project_id AND r.revision = c.revision
      )) = COALESCE(NEW.repository_id, (
        SELECT json_extract(r.manifest, '$.repositories[0].id')
        FROM project_revisions r
        WHERE r.project_id = NEW.project_id AND r.revision = NEW.revision
      ))
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

-- A clean scan of one repository must not resolve the contributor flags of
-- a project with more than one repository on its own. A one-repository
-- project resolves its bound flags exactly as migration 0060 did.
DROP TRIGGER project_flags_resolve_on_clean_scan;
CREATE TRIGGER project_flags_resolve_on_clean_scan
AFTER UPDATE OF state ON vetting_assessments
WHEN OLD.state = 'pending' AND NEW.state = 'clean' AND COALESCE((
  SELECT json_array_length(p.manifest, '$.repositories')
  FROM projects p WHERE p.id = NEW.project_id
), 1) <= 1
BEGIN
  UPDATE project_flags
     SET state = 'resolved', closed_at = NEW.completed_at,
         closed_by = 'clean-scan', closed_reference = NEW.id
   WHERE project_id = NEW.project_id AND state = 'active'
     AND id IN (SELECT value FROM json_each(NEW.flag_ids));
END;

-- A project with more than one repository resolves a flag bound to this
-- clean scan only when every repository its current manifest lists has a
-- clean scan bound to that flag, so requested while the flag was active.
-- This scan is already clean here, so the last repository to turn clean
-- resolves the flag. A scan belongs to the repository whose id it names; a
-- NULL id is the first repository of the scan's own revision.
CREATE TRIGGER project_flags_resolve_on_clean_repository_scans
AFTER UPDATE OF state ON vetting_assessments
WHEN OLD.state = 'pending' AND NEW.state = 'clean' AND COALESCE((
  SELECT json_array_length(p.manifest, '$.repositories')
  FROM projects p WHERE p.id = NEW.project_id
), 1) > 1
BEGIN
  UPDATE project_flags
     SET state = 'resolved', closed_at = NEW.completed_at,
         closed_by = 'clean-scan', closed_reference = NEW.id
   WHERE project_id = NEW.project_id AND state = 'active'
     AND id IN (SELECT value FROM json_each(NEW.flag_ids))
     AND NOT EXISTS (
       SELECT 1 FROM projects p, json_each(p.manifest, '$.repositories') listed
        WHERE p.id = NEW.project_id
          AND NOT EXISTS (
            SELECT 1 FROM vetting_assessments a, json_each(a.flag_ids) bound
             WHERE a.project_id = NEW.project_id AND a.state = 'clean'
               AND bound.value = project_flags.id
               AND COALESCE(a.repository_id, (
                 SELECT json_extract(r.manifest, '$.repositories[0].id')
                 FROM project_revisions r
                 WHERE r.project_id = a.project_id AND r.revision = a.revision
               )) = json_extract(listed.value, '$.id')
          )
     );
END;

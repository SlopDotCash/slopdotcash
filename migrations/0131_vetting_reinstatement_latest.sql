-- A planned reinstatement can race the completion of a later investigation.
-- Recheck the newest-completed, same-repository/pin/content rule for every
-- repository's planned clean evidence in the INSERT transaction. Pending
-- scans remain excluded, and a still later clean scan supersedes an incomplete
-- one. Earlier assessments stay immutable. Older application versions without
-- the selected assessment list can reinstate only a single-repository project.
CREATE TRIGGER project_enforcements_scan_reinstatement_latest
BEFORE INSERT ON project_enforcements
WHEN NEW.actor_role = 'vetting-service' AND NEW.action = 'reinstate'
  AND NOT EXISTS (
    WITH planned AS (
      SELECT a.*, COALESCE(a.repository_id, (
        SELECT json_extract(r.manifest, '$.repositories[0].id')
        FROM project_revisions r
        WHERE r.project_id = a.project_id AND r.revision = a.revision
      )) AS scanned_repository
      FROM json_each(COALESCE(
        json_extract(NEW.system_issuer, '$.assessmentIds'),
        json_array(json_extract(NEW.system_issuer, '$.assessmentId'))
      )) selected
      LEFT JOIN vetting_assessments a ON a.id = selected.value
    )
    SELECT 1 FROM projects p
    WHERE p.id = NEW.project_id
      AND EXISTS (
        SELECT 1 FROM planned
        WHERE id = json_extract(NEW.system_issuer, '$.assessmentId')
      )
      AND NOT EXISTS (
        SELECT 1 FROM json_each(p.manifest, '$.repositories') listed
        WHERE NOT EXISTS (
          SELECT 1 FROM planned
          WHERE scanned_repository = json_extract(listed.value, '$.id')
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM planned a
        WHERE a.id IS NULL OR a.project_id <> NEW.project_id
          OR a.state <> 'clean' OR (
            SELECT latest.state FROM vetting_assessments latest
            WHERE latest.project_id = a.project_id
              AND COALESCE(latest.repository_id, (
                SELECT json_extract(r.manifest, '$.repositories[0].id')
                FROM project_revisions r
                WHERE r.project_id = latest.project_id AND r.revision = latest.revision
              )) = a.scanned_repository
              AND latest.content_sha256 = a.content_sha256
              AND latest.commit_sha = a.commit_sha
              AND latest.template_sha256 = a.template_sha256
              AND latest.state <> 'pending'
            ORDER BY latest.requested_at DESC, latest.rowid DESC
            LIMIT 1
          ) IS NOT 'clean'
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a scan reinstatement needs the latest completed assessment to be clean');
END;

-- Preserve appeals for accounts selected in a moderator ban, even when
-- they are not the current steward or original applicant (PRD section 8).
-- Keep every existing record and row id. This adds an appeal role only;
-- it grants no ability to change project state or decide an appeal.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE project_enforcements_0070_copy (
  row_id INTEGER, id TEXT, project_id TEXT, sequence INTEGER, action TEXT,
  state_after TEXT, appeal_after TEXT, reason TEXT, evidence_reference TEXT,
  repository_github_id TEXT, repository_keys TEXT, actor_github_id TEXT,
  actor_github_login TEXT, system_issuer TEXT, actor_role TEXT,
  decision_source TEXT, before_revision INTEGER, before_manifest_sha256 TEXT,
  after_revision INTEGER, after_manifest_sha256 TEXT, result TEXT,
  created_at TEXT
) STRICT;
INSERT INTO project_enforcements_0070_copy
SELECT
  rowid, id, project_id, sequence, action, state_after, appeal_after, reason,
  evidence_reference, repository_github_id, repository_keys, actor_github_id,
  actor_github_login, system_issuer, actor_role, decision_source,
  before_revision, before_manifest_sha256, after_revision,
  after_manifest_sha256, result, created_at
FROM project_enforcements;
DROP TRIGGER project_enforcements_sequence;
DROP TRIGGER project_enforcements_no_update;
DROP TRIGGER project_enforcements_no_delete;
DROP INDEX project_enforcements_repository;
DROP TABLE project_enforcements;

CREATE TABLE project_enforcements (
  id TEXT PRIMARY KEY CHECK (id GLOB 'enf_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL REFERENCES projects(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  action TEXT NOT NULL CHECK (
    action IN ('quarantine', 'ban', 'request_reinstatement', 'reinstate', 'deny_reinstatement')
  ),
  state_after TEXT NOT NULL CHECK (state_after IN ('clear', 'quarantined', 'banned')),
  appeal_after TEXT NOT NULL CHECK (appeal_after IN ('none', 'requested', 'granted', 'denied')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  evidence_reference TEXT NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 500),
  repository_github_id TEXT NOT NULL CHECK (repository_github_id GLOB '[1-9]*'),
  repository_keys TEXT NOT NULL CHECK (
    json_valid(repository_keys) AND json_type(repository_keys) = 'array' AND
    json_array_length(repository_keys) > 0
  ),
  actor_github_id TEXT CHECK (actor_github_id GLOB '[1-9]*'),
  actor_github_login TEXT CHECK (length(actor_github_login) BETWEEN 1 AND 39),
  system_issuer TEXT CHECK (system_issuer IS NULL OR json_valid(system_issuer)),
  actor_role TEXT NOT NULL CHECK (
    actor_role IN (
      'project-moderator', 'project-steward', 'project-applicant', 'banned-account',
      'vetting-service', 'contributor-flags'
    )
  ),
  decision_source TEXT NOT NULL CHECK (decision_source IN ('admin-panel', 'owner-request', 'account-request', 'standing-rule')),
  before_revision INTEGER NOT NULL CHECK (before_revision > 0),
  before_manifest_sha256 TEXT NOT NULL CHECK (length(before_manifest_sha256) = 64),
  after_revision INTEGER CHECK (after_revision IS NULL OR after_revision = before_revision + 1),
  after_manifest_sha256 TEXT CHECK (
    after_manifest_sha256 IS NULL OR length(after_manifest_sha256) = 64
  ),
  result TEXT NOT NULL CHECK (
    result IN ('revision_appended', 'revision_pending', 'no_revision_needed')
  ),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, sequence),
  CHECK ((after_revision IS NULL) = (after_manifest_sha256 IS NULL)),
  CHECK ((result = 'revision_appended') = (after_revision IS NOT NULL)),
  CHECK (
    (action = 'quarantine' AND state_after = 'quarantined') OR
    (action = 'ban' AND state_after = 'banned') OR
    (action = 'request_reinstatement' AND state_after <> 'clear' AND appeal_after = 'requested') OR
    (
      action = 'reinstate' AND state_after = 'clear' AND (
        appeal_after = 'granted' OR
        (actor_role = 'vetting-service' AND appeal_after = 'none')
      )
    ) OR
    (action = 'deny_reinstatement' AND state_after <> 'clear' AND appeal_after = 'denied')
  ),
  -- A moderator acts from the admin panel; an owner only files an appeal.
  -- The signed vetting service may ban on confirmed malice, or reinstate a
  -- pause that flags alone placed after a clean fresh scan. Two distinct
  -- contributor flags may only quarantine.
  CHECK (
    (actor_role = 'project-moderator' AND decision_source = 'admin-panel' AND actor_github_id IS NOT NULL AND actor_github_login IS NOT NULL AND system_issuer IS NULL) OR
    (
      actor_role IN ('project-steward', 'project-applicant') AND
      decision_source = 'owner-request' AND action = 'request_reinstatement' AND actor_github_id IS NOT NULL AND actor_github_login IS NOT NULL AND system_issuer IS NULL
    ) OR (
      actor_role = 'banned-account' AND decision_source = 'account-request'
      AND action = 'request_reinstatement'
      AND actor_github_id IS NOT NULL AND actor_github_login IS NOT NULL
      AND system_issuer IS NULL
    ) OR (
      actor_role = 'vetting-service' AND decision_source = 'standing-rule'
      AND actor_github_id IS NULL AND actor_github_login IS NULL
      AND system_issuer IS NOT NULL
      AND COALESCE(json_extract(system_issuer, '$.kind') = 'vetting-service'
      AND length(json_extract(system_issuer, '$.keySha256')) = 64
      AND length(json_extract(system_issuer, '$.assessmentId')) > 0
      AND length(json_extract(system_issuer, '$.policyVersion')) > 0
      AND length(json_extract(system_issuer, '$.rule')) > 0
      AND (
        action = 'ban' OR (
          action = 'reinstate' AND
          json_extract(system_issuer, '$.rule') = 'clean-fresh-scan-after-flags'
        )
      ), 0)
    ) OR (
      actor_role = 'contributor-flags' AND decision_source = 'standing-rule'
      AND action = 'quarantine' AND actor_github_id IS NULL
      AND actor_github_login IS NULL AND system_issuer IS NOT NULL
      AND COALESCE(json_extract(system_issuer, '$.kind') = 'contributor-flags'
      AND json_type(system_issuer, '$.flagIds') = 'array'
      AND json_array_length(system_issuer, '$.flagIds') >= 2, 0)
    )
  )
) STRICT;

INSERT INTO project_enforcements (
  rowid, id, project_id, sequence, action, state_after, appeal_after, reason,
  evidence_reference, repository_github_id, repository_keys, actor_github_id,
  actor_github_login, system_issuer, actor_role, decision_source,
  before_revision, before_manifest_sha256, after_revision,
  after_manifest_sha256, result, created_at
)
SELECT
  row_id, id, project_id, sequence, action, state_after, appeal_after, reason,
  evidence_reference, repository_github_id, repository_keys, actor_github_id,
  actor_github_login, system_issuer, actor_role, decision_source,
  before_revision, before_manifest_sha256, after_revision,
  after_manifest_sha256, result, created_at
FROM project_enforcements_0070_copy
ORDER BY row_id;
DROP TABLE project_enforcements_0070_copy;

CREATE INDEX project_enforcements_repository
  ON project_enforcements(repository_github_id);

-- Records form a gapless sequence per project.
CREATE TRIGGER project_enforcements_sequence
BEFORE INSERT ON project_enforcements
WHEN NEW.sequence <> COALESCE(
  (SELECT MAX(sequence) FROM project_enforcements WHERE project_id = NEW.project_id),
  0
) + 1
BEGIN
  SELECT RAISE(ABORT, 'enforcement sequence must be the next record');
END;

CREATE TRIGGER project_enforcements_no_update
BEFORE UPDATE ON project_enforcements
BEGIN
  SELECT RAISE(ABORT, 'project enforcement records are immutable');
END;

CREATE TRIGGER project_enforcements_no_delete
BEFORE DELETE ON project_enforcements
BEGIN
  SELECT RAISE(ABORT, 'project enforcement records are permanent');
END;

PRAGMA foreign_keys = ON;


CREATE TRIGGER project_enforcements_flag_pause_valid
BEFORE INSERT ON project_enforcements
WHEN NEW.actor_role = 'contributor-flags' AND (
  SELECT COUNT(DISTINCT f.reporter_github_id)
    FROM json_each(NEW.system_issuer, '$.flagIds') listed
    JOIN project_flags f ON f.id = listed.value
   WHERE f.project_id = NEW.project_id AND f.state = 'active'
     AND f.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-90 days')
) < 2
BEGIN
  SELECT RAISE(ABORT, 'a flag pause needs two distinct active contributor flags');
END;

CREATE TRIGGER project_enforcements_scan_reinstatement_valid
BEFORE INSERT ON project_enforcements
WHEN NEW.actor_role = 'vetting-service' AND NEW.action = 'reinstate' AND NOT EXISTS (
  SELECT 1 FROM vetting_assessments a
   WHERE a.id = json_extract(NEW.system_issuer, '$.assessmentId')
     AND a.project_id = NEW.project_id AND a.state = 'clean'
     AND NOT EXISTS (
       SELECT 1 FROM project_flags f WHERE f.project_id = NEW.project_id
         AND f.state = 'active' AND f.id NOT IN (SELECT value FROM json_each(a.flag_ids))
     )
     AND a.requested_at >= (
       SELECT created_at FROM project_enforcements latest
        WHERE latest.project_id = NEW.project_id
          AND latest.action IN ('quarantine', 'ban')
        ORDER BY latest.sequence DESC LIMIT 1
     )
     AND (
       SELECT actor_role FROM project_enforcements latest
        WHERE latest.project_id = NEW.project_id
          AND latest.action IN ('quarantine', 'ban')
        ORDER BY latest.sequence DESC LIMIT 1
     ) = 'contributor-flags'
)
BEGIN
  SELECT RAISE(ABORT, 'a scan reinstatement needs a clean fresh scan after a flag-only pause');
END;

CREATE TRIGGER project_flags_resolve_on_reinstatement
AFTER INSERT ON project_enforcements
WHEN NEW.action = 'reinstate'
BEGIN
  UPDATE project_flags
     SET state = 'resolved', closed_at = NEW.created_at,
         closed_by = 'reinstatement', closed_reference = NEW.id
   WHERE project_id = NEW.project_id AND state = 'active'
     AND created_at <= NEW.created_at
     AND (NEW.actor_role <> 'vetting-service' OR id IN (
       SELECT listed.value FROM vetting_assessments a, json_each(a.flag_ids) listed
        WHERE a.id = json_extract(NEW.system_issuer, '$.assessmentId')
     ));
END;

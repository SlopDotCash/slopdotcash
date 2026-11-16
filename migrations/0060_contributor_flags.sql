-- Two-contributor flags (PRD sections 4 and 8; audit finding 9; issue #911).
--
-- A signed-in member files at most one active flag per project, with
-- evidence. The second distinct active reporter pauses the project through
-- the existing append-only enforcement record, in the same transaction as
-- the flag. That record names the flags as its standing-rule issuer; no
-- moderator approves a flag before it counts.
--
-- A flag stops counting when it closes. The reporter may withdraw it. A flag
-- expires 90 days after filing (owner decision D3). A clean scan resolves
-- only flags in its immutable request snapshot. A moderator
-- reinstatement resolves the flags it reviews. A clean fresh scan after a pause
-- that flags alone placed appends a signed vetting-service reinstatement.
-- History is never deleted or rewritten.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE project_enforcements_0060_copy (
  row_id INTEGER, id TEXT, project_id TEXT, sequence INTEGER, action TEXT,
  state_after TEXT, appeal_after TEXT, reason TEXT, evidence_reference TEXT,
  repository_github_id TEXT, repository_keys TEXT, actor_github_id TEXT,
  actor_github_login TEXT, system_issuer TEXT, actor_role TEXT,
  decision_source TEXT, before_revision INTEGER, before_manifest_sha256 TEXT,
  after_revision INTEGER, after_manifest_sha256 TEXT, result TEXT,
  created_at TEXT
) STRICT;
INSERT INTO project_enforcements_0060_copy
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
      'project-moderator', 'project-steward', 'project-applicant',
      'vetting-service', 'contributor-flags'
    )
  ),
  decision_source TEXT NOT NULL CHECK (decision_source IN ('admin-panel', 'owner-request', 'standing-rule')),
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
FROM project_enforcements_0060_copy
ORDER BY row_id;
DROP TABLE project_enforcements_0060_copy;

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

CREATE TABLE project_flags (
  id TEXT PRIMARY KEY CHECK (id GLOB 'flg_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL REFERENCES projects(id),
  reporter_github_id TEXT NOT NULL CHECK (
    length(reporter_github_id) BETWEEN 1 AND 20 AND
    reporter_github_id GLOB '[1-9]*' AND
    reporter_github_id NOT GLOB '*[^0-9]*'
  ),
  reporter_github_login TEXT NOT NULL CHECK (length(reporter_github_login) BETWEEN 1 AND 39),
  -- The registry revision the reporter saw when filing.
  revision INTEGER NOT NULL CHECK (revision > 0),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  category TEXT NOT NULL CHECK (category IN (
    'wallet-drainer', 'credential-theft', 'secret-exfiltration',
    'unsafe-execution', 'prompt-injection', 'other'
  )),
  evidence TEXT NOT NULL CHECK (length(evidence) BETWEEN 20 AND 4000),
  evidence_url TEXT CHECK (
    evidence_url IS NULL OR (
      length(evidence_url) BETWEEN 20 AND 500 AND
      evidence_url GLOB 'https://github.com/*'
    )
  ),
  created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'withdrawn', 'resolved', 'expired')),
  closed_at TEXT,
  closed_by TEXT CHECK (closed_by IS NULL OR closed_by IN ('reporter', 'clean-scan', 'reinstatement', 'lifetime')),
  -- The assessment or enforcement record that resolved the flag.
  closed_reference TEXT,
  FOREIGN KEY (project_id, revision) REFERENCES project_revisions(project_id, revision),
  CHECK ((state = 'active') = (closed_at IS NULL)),
  CHECK ((state = 'active') = (closed_by IS NULL)),
  CHECK (state <> 'withdrawn' OR (closed_by = 'reporter' AND closed_reference IS NULL)),
  CHECK (state <> 'expired' OR (closed_by = 'lifetime' AND closed_reference IS NULL)),
  CHECK (state <> 'resolved' OR (closed_by IN ('clean-scan', 'reinstatement') AND closed_reference IS NOT NULL))
) STRICT;

-- One active flag per contributor and project.
CREATE UNIQUE INDEX project_flags_one_active
  ON project_flags(project_id, reporter_github_id) WHERE state = 'active';
CREATE INDEX project_flags_project ON project_flags(project_id, state, created_at);

-- Bind each new scan to its exact active flag set. Timestamps can tie.
ALTER TABLE vetting_assessments ADD COLUMN flag_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(flag_ids) AND json_type(flag_ids) = 'array');
CREATE TRIGGER vetting_flag_snapshot_fixed
BEFORE UPDATE OF flag_ids ON vetting_assessments
WHEN NEW.flag_ids IS NOT OLD.flag_ids
BEGIN
  SELECT RAISE(ABORT, 'the scan flag snapshot is immutable');
END;

-- The only update closes an active flag once; nothing else changes.
CREATE TRIGGER project_flags_close_once
BEFORE UPDATE ON project_flags
WHEN OLD.state <> 'active' OR NEW.state = 'active' OR
  NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR
  NEW.reporter_github_id <> OLD.reporter_github_id OR
  NEW.reporter_github_login <> OLD.reporter_github_login OR
  NEW.revision <> OLD.revision OR NEW.manifest_sha256 <> OLD.manifest_sha256 OR
  NEW.category <> OLD.category OR NEW.evidence <> OLD.evidence OR
  NEW.evidence_url IS NOT OLD.evidence_url OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'a flag closes once');
END;

CREATE TRIGGER project_flags_no_delete
BEFORE DELETE ON project_flags
BEGIN
  SELECT RAISE(ABORT, 'flags are permanent');
END;

-- A flag pause names at least two distinct active reporters of that
-- project, each filed within the 90-day flag lifetime.
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

-- A scan reinstatement needs a clean assessment of this project requested
-- at or after the latest restriction, which flags alone placed.
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

-- A clean scan resolves only the flags bound to its request.
CREATE TRIGGER project_flags_resolve_on_clean_scan
AFTER UPDATE OF state ON vetting_assessments
WHEN OLD.state = 'pending' AND NEW.state = 'clean'
BEGIN
  UPDATE project_flags
     SET state = 'resolved', closed_at = NEW.completed_at,
         closed_by = 'clean-scan', closed_reference = NEW.id
   WHERE project_id = NEW.project_id AND state = 'active'
     AND id IN (SELECT value FROM json_each(NEW.flag_ids));
END;

-- A scan reinstatement cannot resolve evidence that arrived during the scan.
-- A moderator reinstatement resolves the flags present at that decision.
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

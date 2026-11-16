-- ADM-06 project enforcement: Quarantine, Ban project, and the appeal path.
-- Each action is one append-only operational record with the ADM-05 audit
-- fields. The newest record of a project is its current restriction. A record
-- binds the immutable GitHub repository id and every repository path, so a
-- rename or a new application for the same repository cannot clear it.

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
  actor_github_id TEXT NOT NULL CHECK (actor_github_id GLOB '[1-9]*'),
  actor_github_login TEXT NOT NULL CHECK (length(actor_github_login) BETWEEN 1 AND 39),
  actor_role TEXT NOT NULL CHECK (actor_role = 'project-moderator'),
  decision_source TEXT NOT NULL CHECK (decision_source = 'admin-panel'),
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
    (action = 'reinstate' AND state_after = 'clear' AND appeal_after = 'granted') OR
    (action = 'deny_reinstatement' AND state_after <> 'clear' AND appeal_after = 'denied')
  )
) STRICT;

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

-- ELG-02 appeal path for ADM-06 project enforcement: the project steward or
-- the applicant who listed the project may record a reinstatement request.
-- Only a project moderator may quarantine, ban, reinstate or deny.
--
-- actor_role adds 'project-steward' and 'project-applicant', and
-- decision_source adds 'owner-request'. Both are allowed only on a
-- request_reinstatement record. Every other column, the append-only triggers
-- and the gapless sequence are unchanged.
--
-- The rebuild follows 0021: copy the rows into a plain holding table, drop the
-- original (triggers first), create the replacement under its own name,
-- re-insert, drop the holding table, and recreate the index and triggers. The
-- copy keeps each rowid, because the public edge cache keys on
-- MAX(rowid) (the enforcement generation), which must never go back.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE project_enforcements_0027_copy (
  row_id INTEGER, id TEXT, project_id TEXT, sequence INTEGER, action TEXT,
  state_after TEXT, appeal_after TEXT, reason TEXT, evidence_reference TEXT,
  repository_github_id TEXT, repository_keys TEXT, actor_github_id TEXT,
  actor_github_login TEXT, actor_role TEXT, decision_source TEXT,
  before_revision INTEGER, before_manifest_sha256 TEXT, after_revision INTEGER,
  after_manifest_sha256 TEXT, result TEXT, created_at TEXT
) STRICT;
INSERT INTO project_enforcements_0027_copy
SELECT
  rowid, id, project_id, sequence, action, state_after, appeal_after, reason,
  evidence_reference, repository_github_id, repository_keys, actor_github_id,
  actor_github_login, actor_role, decision_source, before_revision,
  before_manifest_sha256, after_revision, after_manifest_sha256, result,
  created_at
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
  actor_github_id TEXT NOT NULL CHECK (actor_github_id GLOB '[1-9]*'),
  actor_github_login TEXT NOT NULL CHECK (length(actor_github_login) BETWEEN 1 AND 39),
  actor_role TEXT NOT NULL CHECK (
    actor_role IN ('project-moderator', 'project-steward', 'project-applicant')
  ),
  decision_source TEXT NOT NULL CHECK (decision_source IN ('admin-panel', 'owner-request')),
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
  ),
  -- A moderator acts from the admin panel; an owner only files an appeal.
  CHECK (
    (actor_role = 'project-moderator' AND decision_source = 'admin-panel') OR
    (
      actor_role IN ('project-steward', 'project-applicant') AND
      decision_source = 'owner-request' AND action = 'request_reinstatement'
    )
  )
) STRICT;

INSERT INTO project_enforcements (
  rowid, id, project_id, sequence, action, state_after, appeal_after, reason,
  evidence_reference, repository_github_id, repository_keys, actor_github_id,
  actor_github_login, actor_role, decision_source, before_revision,
  before_manifest_sha256, after_revision, after_manifest_sha256, result,
  created_at
)
SELECT
  row_id, id, project_id, sequence, action, state_after, appeal_after, reason,
  evidence_reference, repository_github_id, repository_keys, actor_github_id,
  actor_github_login, actor_role, decision_source, before_revision,
  before_manifest_sha256, after_revision, after_manifest_sha256, result,
  created_at
FROM project_enforcements_0027_copy
ORDER BY row_id;
DROP TABLE project_enforcements_0027_copy;

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

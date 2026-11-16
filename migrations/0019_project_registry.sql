-- The project registry moves from reviewed Git files into D1. Every manifest
-- change appends a revision; the current row is only the latest pointer.

CREATE TABLE project_applications (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 48),
  repository_key TEXT NOT NULL CHECK (
    length(repository_key) BETWEEN 3 AND 201 AND repository_key = lower(repository_key)
  ),
  manifest TEXT NOT NULL CHECK (
    json_valid(manifest) AND
    json_extract(manifest, '$.id') = project_id AND
    json_extract(manifest, '$.status') = 'paused'
  ),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  acceptance_criteria TEXT NOT NULL CHECK (length(acceptance_criteria) BETWEEN 6 AND 1000),
  applicant_github_id TEXT NOT NULL CHECK (applicant_github_id GLOB '[1-9]*'),
  applicant_github_login TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notification TEXT NOT NULL CHECK (admin_notification IN ('pending', 'sent', 'failed')),
  admin_notification_at TEXT,
  decided_at TEXT,
  decided_by_github_id TEXT,
  decided_by_github_login TEXT,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 1000),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by_github_id IS NULL AND
      decided_by_github_login IS NULL AND decision_reason IS NULL) OR
    (status = 'approved' AND decided_at IS NOT NULL AND decided_by_github_id IS NOT NULL AND
      decided_by_github_login IS NOT NULL) OR
    (status = 'rejected' AND decided_at IS NOT NULL AND decided_by_github_id IS NOT NULL AND
      decided_by_github_login IS NOT NULL AND decision_reason IS NOT NULL)
  ),
  CHECK (
    (admin_notification = 'pending' AND admin_notification_at IS NULL) OR
    (admin_notification <> 'pending' AND admin_notification_at IS NOT NULL)
  )
) STRICT;

-- One open application per project id and per repository.
CREATE UNIQUE INDEX project_applications_one_pending_project
  ON project_applications(project_id) WHERE status = 'pending';
CREATE UNIQUE INDEX project_applications_one_pending_repository
  ON project_applications(repository_key) WHERE status = 'pending';
CREATE INDEX project_applications_status
  ON project_applications(status, submitted_at);
CREATE INDEX project_applications_applicant
  ON project_applications(applicant_github_id, submitted_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 48),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  manifest TEXT NOT NULL CHECK (
    json_valid(manifest) AND
    json_extract(manifest, '$.id') = id AND
    json_extract(manifest, '$.status') = status
  ),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_application_id TEXT UNIQUE REFERENCES project_applications(id)
) STRICT;

-- Repository identity is unique across the whole registry.
CREATE TABLE project_repositories (
  repository_key TEXT PRIMARY KEY CHECK (
    length(repository_key) BETWEEN 3 AND 201 AND repository_key = lower(repository_key)
  ),
  project_id TEXT NOT NULL REFERENCES projects(id)
) STRICT;

CREATE INDEX project_repositories_project ON project_repositories(project_id);

-- Revisions are written before their project pointer, so the link between
-- them is enforced by the projects triggers below instead of a foreign key.
CREATE TABLE project_revisions (
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 48),
  revision INTEGER NOT NULL CHECK (revision > 0),
  manifest TEXT NOT NULL CHECK (
    json_valid(manifest) AND json_extract(manifest, '$.id') = project_id
  ),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  actor_github_id TEXT,
  actor_github_login TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, revision),
  CHECK ((actor_github_id IS NULL) = (actor_github_login IS NULL))
) STRICT;

CREATE TRIGGER project_revisions_no_update
BEFORE UPDATE ON project_revisions
BEGIN
  SELECT RAISE(ABORT, 'project revisions are immutable');
END;

CREATE TRIGGER project_revisions_no_delete
BEFORE DELETE ON project_revisions
BEGIN
  SELECT RAISE(ABORT, 'project revisions are permanent');
END;

-- A project can be paused but never removed; its policy history stays public.
CREATE TRIGGER projects_no_delete
BEFORE DELETE ON projects
BEGIN
  SELECT RAISE(ABORT, 'projects are permanent; pause instead');
END;

-- The current pointer must always match the newest appended revision.
CREATE TRIGGER projects_match_revision_insert
AFTER INSERT ON projects
WHEN NOT EXISTS (
  SELECT 1 FROM project_revisions
   WHERE project_id = NEW.id
     AND revision = NEW.revision
     AND manifest_sha256 = NEW.manifest_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'project row requires its appended revision');
END;

CREATE TRIGGER projects_match_revision_update
BEFORE UPDATE ON projects
WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 OR NOT EXISTS (
  SELECT 1 FROM project_revisions
   WHERE project_id = NEW.id
     AND revision = NEW.revision
     AND manifest_sha256 = NEW.manifest_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'project update requires the next appended revision');
END;

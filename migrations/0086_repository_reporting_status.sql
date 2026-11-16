-- Public repository readiness is a background observation, never case data.
-- A changed registry revision or intake repository cannot reuse an old check.
CREATE TABLE repository_reporting_status (
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_revision INTEGER NOT NULL CHECK (project_revision > 0),
  repository_key TEXT NOT NULL,
  repository_id TEXT,
  repository_node_id TEXT,
  enabled INTEGER CHECK (enabled IN (0, 1)),
  verified_at TEXT,
  attempted_at TEXT NOT NULL,
  failure TEXT CHECK (failure IN ('unavailable', 'app-not-installed', 'identity-mismatch')),
  CHECK ((enabled IS NULL AND verified_at IS NULL) OR
         (enabled IS NOT NULL AND verified_at IS NOT NULL AND repository_id IS NOT NULL AND repository_node_id IS NOT NULL)),
  PRIMARY KEY (project_id, project_revision, repository_key)
) STRICT;

-- Projects registered before the security-vetting gate are grandfathered:
-- they serve skills, list for discovery and activate without a scan. Only
-- projects present when this migration runs are recorded. A confirmed
-- malicious finding still bans a grandfathered project.
CREATE TABLE vetting_grandfathered_projects (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  granted_at TEXT NOT NULL
) STRICT;
INSERT INTO vetting_grandfathered_projects(project_id, granted_at)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM projects;
CREATE TRIGGER vetting_grandfathered_projects_no_insert
BEFORE INSERT ON vetting_grandfathered_projects
BEGIN SELECT RAISE(ABORT, 'grandfathered projects are fixed'); END;
CREATE TRIGGER vetting_grandfathered_projects_no_update
BEFORE UPDATE ON vetting_grandfathered_projects
BEGIN SELECT RAISE(ABORT, 'grandfathered projects are immutable'); END;
CREATE TRIGGER vetting_grandfathered_projects_no_delete
BEFORE DELETE ON vetting_grandfathered_projects
BEGIN SELECT RAISE(ABORT, 'grandfathered projects are permanent'); END;

-- spec/backend/projects.md, "A finalized owner vault registration appends one revision for the current maintainer":
-- a vault registration is its own revision kind. The kind check of 0200 is widened by rebuilding the table, and the
-- owner vault registrations recorded before kinds existed (their reasons are fixed by the vault setup route) get theirs.
CREATE TABLE project_revision_kinds_next (
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  kind TEXT NOT NULL CHECK (kind IN ('Created', 'Activated', 'OwnerUpdate', 'RepositoryAppended', 'Removed', 'AdminHold', 'AdminDelist', 'AdminException', 'RestrictionRetirement', 'CommunityRestored', 'Placement', 'ConsentChanged', 'VaultRegistered')),
  PRIMARY KEY (project_id, revision),
  FOREIGN KEY (project_id, revision) REFERENCES project_revisions(project_id, revision),
  CHECK ((kind = 'Created') = (revision = 1))
) STRICT;

INSERT INTO project_revision_kinds_next (project_id, revision, kind)
SELECT project_id, revision, kind FROM project_revision_kinds;

DROP TABLE project_revision_kinds;
ALTER TABLE project_revision_kinds_next RENAME TO project_revision_kinds;

CREATE TRIGGER project_revision_kinds_no_update BEFORE UPDATE ON project_revision_kinds
BEGIN SELECT RAISE(ABORT, 'project revision kind immutable'); END;
CREATE TRIGGER project_revision_kinds_no_delete BEFORE DELETE ON project_revision_kinds
BEGIN SELECT RAISE(ABORT, 'project revision kind permanent'); END;

INSERT INTO project_revision_kinds (project_id, revision, kind)
SELECT r.project_id, r.revision, 'VaultRegistered'
  FROM project_revisions r
  LEFT JOIN project_revision_kinds k ON k.project_id = r.project_id AND k.revision = r.revision
 WHERE r.revision > 1 AND k.kind IS NULL AND r.actor_github_id IS NOT NULL
   AND (r.reason GLOB 'Owner registered a finalized vault *' OR r.reason GLOB 'Slop finished the owner''s saved vault registration after finality*');

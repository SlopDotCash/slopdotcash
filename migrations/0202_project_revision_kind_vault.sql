-- spec/backend/projects.md, "A finalized owner vault registration appends one revision for the current maintainer":
-- a vault registration is its own revision kind. The kind check of 0200 is widened by rebuilding the table, and the
-- owner vault registrations recorded without a kind get theirs.
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

-- Each earlier finalized vault registration that 0200 left without a kind, classified by the exact reason the vault
-- registration route writes (apps/backend/src/projects/vault/register.vibe; development backend/projects), as 0200
-- classifies later revisions by their reasons, never by a project list. The registrations before 8 November 2026
-- already carry the OwnerUpdate kind 0200 gave them, which is immutable. Read against production on 21 November 2026
-- (GET /api/v1/project-revisions), this classifies asi 8, feed 7, fly-ai 9, teeny-s-brain 3 and toon-plugins 3.
INSERT INTO project_revision_kinds (project_id, revision, kind)
SELECT r.project_id, r.revision, 'VaultRegistered'
  FROM project_revisions r
  LEFT JOIN project_revision_kinds k ON k.project_id = r.project_id AND k.revision = r.revision
 WHERE k.kind IS NULL
   AND r.revision > 1
   AND r.reason IN (
     'Owner registered a finalized vault verified against the reviewed factory and project policy.',
     'Slop finished the owner''s saved vault registration after finality, verified against the reviewed factory and project policy.'
   );

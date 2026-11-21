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

-- Each earlier finalized vault registration that 0200 left without a kind, pinned to its reviewed manifest digest the
-- way 0200 pins its classifications (production registry, GET /api/v1/project-revisions, read 20 November 2026). The
-- registrations before 8 November 2026 already carry the OwnerUpdate kind 0200 gave them, which is immutable.
INSERT INTO project_revision_kinds (project_id, revision, kind)
WITH reviewed (project_id, revision, manifest_sha256) AS (VALUES
  ('asi', 8, 'fc31cd2019bcff2c7b1971f1c04ae5689fade4e45b3f577f0ee715d2296398e4'),
  ('feed', 7, 'd600433ac17e054357e350e7718e64f67041b27153b71d26f10c9fab059ee390'),
  ('fly-ai', 9, 'd170e1e6de34b735fdad414633a641f14c590d51b62bf4701f39bf6cab2fedfa'),
  ('teeny-s-brain', 3, 'dd81dbde822aa7560306aa1b5f31fd940f024265f7031895dc020e86fbda6539'),
  ('toon-plugins', 3, '4517bf57fb661b203a883265dbbd49d8cdaeceae2d7c26d1314b13af383fa33c')
)
SELECT r.project_id, r.revision, 'VaultRegistered'
  FROM project_revisions r
  JOIN reviewed ON reviewed.project_id = r.project_id AND reviewed.revision = r.revision AND reviewed.manifest_sha256 = r.manifest_sha256
  LEFT JOIN project_revision_kinds k ON k.project_id = r.project_id AND k.revision = r.revision
 WHERE k.kind IS NULL;

-- Participation points are discontinued (PRD section 11, owner decision of
-- 24 October 2026, D2). Joining no longer records a five-point welcome award,
-- and a first verified X connection no longer records a ten-point award.
--
-- Membership rows are never deleted or rewritten. Every existing row keeps
-- its recorded welcome value and row id as a historical record that no
-- displayed total counts. New rows record zero, and the database refuses any
-- new welcome award. SQLite cannot alter a CHECK or DEFAULT in place, so the
-- table is rebuilt as in 0063 and 0070: copy the rows aside, drop the
-- triggers and table, create the replacement under the same name so every
-- child foreign key still resolves, copy the rows back before any insert
-- trigger exists, then recreate every trigger.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE points_members_0080_copy (
  row_id INTEGER, actor_id TEXT, github_id TEXT, login TEXT, joined_at TEXT,
  public INTEGER, welcome INTEGER, closed_at TEXT
) STRICT;
INSERT INTO points_members_0080_copy
SELECT rowid, actor_id, github_id, login, joined_at, public, welcome, closed_at
FROM points_members;

DROP TRIGGER points_members_identity;
DROP TRIGGER points_members_no_delete;
DROP TRIGGER points_members_closed_private;
DROP TABLE points_members;

CREATE TABLE points_members (
  actor_id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  public INTEGER NOT NULL CHECK (public IN (0, 1)),
  -- 5 only on rows recorded before this migration; never counted.
  welcome INTEGER NOT NULL DEFAULT 0 CHECK (welcome IN (0, 5)),
  closed_at TEXT
    CHECK (closed_at IS NULL OR length(closed_at) BETWEEN 20 AND 30)
) STRICT;

INSERT INTO points_members(rowid, actor_id, github_id, login, joined_at, public, welcome, closed_at)
SELECT row_id, actor_id, github_id, login, joined_at, public, welcome, closed_at
FROM points_members_0080_copy ORDER BY row_id;
DROP TABLE points_members_0080_copy;

CREATE TRIGGER points_members_no_new_welcome
BEFORE INSERT ON points_members
WHEN NEW.welcome <> 0
BEGIN
  SELECT RAISE(ABORT, 'welcome points are discontinued');
END;

CREATE TRIGGER points_members_identity
BEFORE UPDATE ON points_members
WHEN NEW.actor_id != OLD.actor_id OR NEW.github_id != OLD.github_id OR
  NEW.joined_at != OLD.joined_at OR NEW.welcome != OLD.welcome
BEGIN
  SELECT RAISE(ABORT, 'immutable points membership');
END;

CREATE TRIGGER points_members_no_delete
BEFORE DELETE ON points_members
BEGIN
  SELECT RAISE(ABORT, 'points membership preserves welcome uniqueness');
END;

-- A closed membership is never public.
CREATE TRIGGER points_members_closed_private
BEFORE UPDATE ON points_members
WHEN NEW.closed_at IS NOT NULL AND NEW.public <> 0
BEGIN
  SELECT RAISE(ABORT, 'a closed account is not public');
END;

-- Existing X connection awards stay as permanent history; none are added.
CREATE TRIGGER points_x_awards_discontinued
BEFORE INSERT ON points_x_awards
BEGIN
  SELECT RAISE(ABORT, 'X connection points are discontinued');
END;

PRAGMA foreign_keys = ON;

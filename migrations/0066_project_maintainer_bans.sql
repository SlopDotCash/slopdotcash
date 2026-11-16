-- A moderator decides a confirmed malicious result (PRD sections 2 and 8):
-- reinstate the project, or ban it and its maintainer. The maintainer ban
-- rides on the moderator's Ban record of that decision, in the same write.
-- The ban holds while that project restriction holds; a later reinstatement
-- of the project lifts it. History remains permanent.
CREATE TABLE project_maintainer_bans (
  enforcement_id TEXT NOT NULL REFERENCES project_enforcements(id),
  github_id TEXT NOT NULL CHECK (
    length(github_id) BETWEEN 1 AND 20 AND
    github_id GLOB '[1-9]*' AND github_id NOT GLOB '*[^0-9]*'
  ),
  github_login TEXT NOT NULL CHECK (length(github_login) BETWEEN 1 AND 39),
  PRIMARY KEY (enforcement_id, github_id)
) STRICT;
CREATE INDEX project_maintainer_bans_account
  ON project_maintainer_bans(github_id);

-- Only a moderator's Ban that decides a signed confirmed malicious Ban may
-- ban a maintainer.
CREATE TRIGGER project_maintainer_bans_valid
BEFORE INSERT ON project_maintainer_bans
WHEN NOT EXISTS (
  SELECT 1 FROM project_enforcements e
   WHERE e.id = NEW.enforcement_id AND e.action = 'ban'
     AND e.actor_role = 'project-moderator'
     AND (
       SELECT previous.actor_role FROM project_enforcements previous
        WHERE previous.project_id = e.project_id
          AND previous.sequence < e.sequence
          AND previous.action IN ('quarantine', 'ban')
        ORDER BY previous.sequence DESC LIMIT 1
     ) = 'vetting-service'
     AND (
       SELECT previous.state_after FROM project_enforcements previous
        WHERE previous.project_id = e.project_id
          AND previous.sequence = e.sequence - 1
     ) = 'banned'
)
BEGIN
  SELECT RAISE(ABORT, 'a maintainer ban needs a moderator decision on a confirmed malicious ban');
END;
CREATE TRIGGER project_maintainer_bans_no_update
BEFORE UPDATE ON project_maintainer_bans
BEGIN
  SELECT RAISE(ABORT, 'maintainer bans are immutable');
END;
CREATE TRIGGER project_maintainer_bans_no_delete
BEFORE DELETE ON project_maintainer_bans
BEGIN
  SELECT RAISE(ABORT, 'maintainer bans are permanent');
END;

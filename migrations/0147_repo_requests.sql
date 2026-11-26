-- Requested repos (PRD section 11, "Referral program"). A signed-in member
-- with merged work on Slop flags a public GitHub repository that is not on
-- Slop as one they would work on. The public board counts active flags per
-- repository and never names who flagged it.
--
-- One row per repository and account. `repo_id` is GitHub's permanent
-- repository id, so a flag survives a rename; `full_name` is the name GitHub
-- answered at the last flag. A flag counts while `withdrawn_at` is null and
-- `expires_at` is later than now. Flagging again renews it for 90 days and
-- clears `withdrawn_at`. Rows are never deleted or moved to another
-- repository or account.
CREATE TABLE repo_requests (
  repo_id TEXT NOT NULL CHECK (
    repo_id GLOB '[1-9]*' AND repo_id NOT GLOB '*[^0-9]*'
  ),
  github_id TEXT NOT NULL CHECK (
    github_id GLOB '[1-9]*' AND github_id NOT GLOB '*[^0-9]*'
  ),
  full_name TEXT NOT NULL CHECK (
    length(full_name) BETWEEN 3 AND 140 AND full_name GLOB '?*/?*'
  ),
  created_at TEXT NOT NULL,
  flagged_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > flagged_at),
  withdrawn_at TEXT,
  PRIMARY KEY (repo_id, github_id)
) STRICT;

CREATE INDEX repo_requests_account ON repo_requests(github_id, expires_at);
CREATE INDEX repo_requests_active ON repo_requests(expires_at, repo_id)
WHERE withdrawn_at IS NULL;

CREATE TRIGGER repo_requests_identity_fixed
BEFORE UPDATE ON repo_requests
WHEN NEW.repo_id IS NOT OLD.repo_id
  OR NEW.github_id IS NOT OLD.github_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'repo request identity is permanent'); END;

CREATE TRIGGER repo_requests_no_delete
BEFORE DELETE ON repo_requests
BEGIN SELECT RAISE(ABORT, 'repo requests are permanent'); END;

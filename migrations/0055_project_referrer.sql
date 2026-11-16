-- Referral attribution (PRD PRJ-05). The maintainer who submits an
-- application may name the signed-in Slop account that referred the project.
-- The API records it once at submission, approval copies it to the project,
-- and neither row can change it afterwards. It is a record only: nothing in
-- the registry, scoring, rewards or settlement reads it.
ALTER TABLE project_applications ADD COLUMN referrer_github_id TEXT CHECK (
  referrer_github_id IS NULL OR referrer_github_id GLOB '[1-9]*'
);
ALTER TABLE project_applications ADD COLUMN referrer_github_login TEXT CHECK (
  referrer_github_login IS NULL OR length(referrer_github_login) BETWEEN 1 AND 39
);
ALTER TABLE projects ADD COLUMN referrer_github_id TEXT CHECK (
  referrer_github_id IS NULL OR referrer_github_id GLOB '[1-9]*'
);
ALTER TABLE projects ADD COLUMN referrer_github_login TEXT CHECK (
  referrer_github_login IS NULL OR length(referrer_github_login) BETWEEN 1 AND 39
);

CREATE TRIGGER project_applications_referrer_pair
BEFORE INSERT ON project_applications
WHEN (NEW.referrer_github_id IS NULL) <> (NEW.referrer_github_login IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'application referrer needs both id and login');
END;

CREATE TRIGGER project_applications_referrer_immutable
BEFORE UPDATE ON project_applications
WHEN NEW.referrer_github_id IS NOT OLD.referrer_github_id
  OR NEW.referrer_github_login IS NOT OLD.referrer_github_login
BEGIN
  SELECT RAISE(ABORT, 'application referrer is immutable');
END;

CREATE TRIGGER projects_referrer_pair
BEFORE INSERT ON projects
WHEN (NEW.referrer_github_id IS NULL) <> (NEW.referrer_github_login IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'project referrer needs both id and login');
END;

CREATE TRIGGER projects_referrer_immutable
BEFORE UPDATE ON projects
WHEN NEW.referrer_github_id IS NOT OLD.referrer_github_id
  OR NEW.referrer_github_login IS NOT OLD.referrer_github_login
BEGIN
  SELECT RAISE(ABORT, 'project referrer is immutable');
END;

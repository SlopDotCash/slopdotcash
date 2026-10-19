-- The registry records what public GitHub facts showed about the applicant's
-- control of the repository, so an admin sees it before approving. Every
-- application still waits for an admin (PRD PRJ-02).
ALTER TABLE project_applications ADD COLUMN github_check TEXT CHECK (
  github_check IS NULL OR length(github_check) BETWEEN 1 AND 300
);

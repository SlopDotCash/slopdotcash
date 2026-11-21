-- A project's wanted label (operator decision, 21 November 2026; PRD
-- section 5). The same scheduled read that fills `repository_merge_activity`
-- also lists the open issues that carry the owner's wanted label, so project
-- pages show what the maintainers most want done without reading GitHub per
-- page view (PRD section 9).
--
-- `wanted_label` is the label read in the stored observation and
-- `wanted_issues` its open issues as JSON (number, title, URL and open
-- closing pull request count, oldest first). Both are NULL when the project
-- has no wanted label or the repository was not read since this migration.
-- `wanted_label_ready` is the label name Slopbot last confirmed exists on the
-- repository; a different or NULL value means it is checked again.
ALTER TABLE repository_merge_activity
  ADD COLUMN wanted_label TEXT CHECK (wanted_label IS NULL OR length(wanted_label) BETWEEN 1 AND 50);
ALTER TABLE repository_merge_activity
  ADD COLUMN wanted_issues TEXT CHECK (wanted_issues IS NULL OR json_valid(wanted_issues));
ALTER TABLE repository_merge_activity
  ADD COLUMN wanted_label_ready TEXT CHECK (wanted_label_ready IS NULL OR length(wanted_label_ready) BETWEEN 1 AND 50);

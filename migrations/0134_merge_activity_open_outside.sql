-- A maintainer's intake cap (operator decision, 17 November 2026; PRD
-- section 5). The same scheduled read that fills `repository_merge_activity`
-- also counts every open pull request from an outside contributor (author not
-- an owner, member or collaborator, not a bot, not a draft), whether or not a
-- maintainer has answered it. A project whose owner set an intake cap pauses
-- new contributors while this count is at or above the cap.
--
-- NULL means the count has not been read since this migration; such a row
-- pauses nothing. `open_outside_capped` is 1 when the repository has more
-- open pull requests than one read counts, so the stored count is a floor.
ALTER TABLE repository_merge_activity
  ADD COLUMN open_outside INTEGER CHECK (open_outside IS NULL OR open_outside >= 0);
ALTER TABLE repository_merge_activity
  ADD COLUMN open_outside_capped INTEGER CHECK (open_outside_capped IS NULL OR open_outside_capped IN (0, 1));

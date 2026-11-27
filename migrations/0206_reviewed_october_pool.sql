ALTER TABLE monthly_reward_bases ADD COLUMN reviewed_october INTEGER NOT NULL DEFAULT 0
 CHECK(reviewed_october = 0 OR (
   reviewed_october = 1 AND project_id IN ('eliza', 'slopdotcash') AND period = '2026-10'
   AND cap_base = '1000000000' AND early_close_at IS NULL
 ));

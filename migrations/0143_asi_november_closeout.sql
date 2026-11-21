ALTER TABLE monthly_reward_bases ADD COLUMN early_close_at TEXT
 CHECK(early_close_at IS NULL OR (
   project_id='asi' AND period='2026-11'
   AND early_close_at='2026-11-19T00:00:00.000Z' AND cap_base='150000000'
 ));

CREATE TRIGGER monthly_allocation_changes_fixed_closeout
BEFORE INSERT ON monthly_allocation_changes
WHEN EXISTS(
 SELECT 1 FROM monthly_reward_bases
 WHERE project_id=NEW.project_id AND period=NEW.period AND early_close_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'reviewed closeout allocations fixed'); END;

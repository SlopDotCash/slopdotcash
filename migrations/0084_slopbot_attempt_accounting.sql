-- Owner decision, 25 October 2026: alerts-only records attempts without a
-- fictional maximum. Numeric capped reservations retain their existing terms.
-- Recreate only the parent under its original name. Deferred foreign keys keep
-- reconciliations and retained inference results intact in the D1 transaction.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE slopbot_budget_0084_copy AS SELECT * FROM slopbot_value_budget_reservations;
DROP TABLE slopbot_value_budget_reservations;
CREATE TABLE slopbot_value_budget_reservations (
 attempt_id TEXT PRIMARY KEY,
 month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
 reserved_micro_usd INTEGER CHECK(reserved_micro_usd IS NULL OR (reserved_micro_usd > 0 AND reserved_micro_usd <= 9007199254740991)),
 approved_limit_micro_usd INTEGER CHECK(approved_limit_micro_usd IS NULL OR (reserved_micro_usd IS NOT NULL AND approved_limit_micro_usd >= reserved_micro_usd AND approved_limit_micro_usd <= 9007199254740991)),
 reserved_at TEXT NOT NULL
) STRICT;
INSERT INTO slopbot_value_budget_reservations SELECT * FROM slopbot_budget_0084_copy;
DROP TABLE slopbot_budget_0084_copy;
CREATE TRIGGER slopbot_value_budget_reservations_immutable BEFORE UPDATE ON slopbot_value_budget_reservations
BEGIN SELECT RAISE(ABORT, 'budget reservation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reservations_no_delete BEFORE DELETE ON slopbot_value_budget_reservations
BEGIN SELECT RAISE(ABORT, 'budget reservation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reservations_no_replace BEFORE INSERT ON slopbot_value_budget_reservations
WHEN EXISTS(SELECT 1 FROM slopbot_value_budget_reservations WHERE attempt_id=NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'budget reservation already exists'); END;

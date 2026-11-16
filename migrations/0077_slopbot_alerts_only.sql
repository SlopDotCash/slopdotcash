-- Explicit alerts-only authorization has no monthly hard cap (owner decision,
-- 24 October 2026). NULL records that choice; existing numeric approvals remain.
-- Copy both FK-linked tables before dropping the child, then the parent.
CREATE TABLE slopbot_budget_saved AS SELECT * FROM slopbot_value_budget_reservations;
CREATE TABLE slopbot_reconciliations_saved AS SELECT * FROM slopbot_value_budget_reconciliations;
DROP TABLE slopbot_value_budget_reconciliations;
DROP TABLE slopbot_value_budget_reservations;
CREATE TABLE slopbot_value_budget_reservations (
 attempt_id TEXT PRIMARY KEY,
 month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
 reserved_micro_usd INTEGER NOT NULL CHECK(reserved_micro_usd > 0 AND reserved_micro_usd <= 9007199254740991),
 approved_limit_micro_usd INTEGER CHECK(approved_limit_micro_usd IS NULL OR (approved_limit_micro_usd >= reserved_micro_usd AND approved_limit_micro_usd <= 9007199254740991)),
 reserved_at TEXT NOT NULL
) STRICT;
CREATE TABLE slopbot_value_budget_reconciliations (
 attempt_id TEXT PRIMARY KEY REFERENCES slopbot_value_budget_reservations(attempt_id),
 call_count INTEGER NOT NULL CHECK(call_count > 0),
 recorded_micro_usd INTEGER NOT NULL CHECK(recorded_micro_usd >= 0 AND recorded_micro_usd <= 9007199254740991),
 reconciled_at TEXT NOT NULL
) STRICT;
INSERT INTO slopbot_value_budget_reservations SELECT * FROM slopbot_budget_saved;
INSERT INTO slopbot_value_budget_reconciliations SELECT * FROM slopbot_reconciliations_saved;
DROP TABLE slopbot_budget_saved;
DROP TABLE slopbot_reconciliations_saved;
CREATE TRIGGER slopbot_value_budget_reservations_immutable BEFORE UPDATE ON slopbot_value_budget_reservations
BEGIN SELECT RAISE(ABORT, 'budget reservation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reservations_no_delete BEFORE DELETE ON slopbot_value_budget_reservations
BEGIN SELECT RAISE(ABORT, 'budget reservation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reservations_no_replace BEFORE INSERT ON slopbot_value_budget_reservations
WHEN EXISTS(SELECT 1 FROM slopbot_value_budget_reservations WHERE attempt_id=NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'budget reservation already exists'); END;
CREATE TRIGGER slopbot_value_budget_reconciliations_immutable BEFORE UPDATE ON slopbot_value_budget_reconciliations
BEGIN SELECT RAISE(ABORT, 'budget reconciliation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reconciliations_no_delete BEFORE DELETE ON slopbot_value_budget_reconciliations
BEGIN SELECT RAISE(ABORT, 'budget reconciliation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reconciliations_no_replace BEFORE INSERT ON slopbot_value_budget_reconciliations
WHEN EXISTS(SELECT 1 FROM slopbot_value_budget_reconciliations WHERE attempt_id=NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'budget reconciliation already exists'); END;

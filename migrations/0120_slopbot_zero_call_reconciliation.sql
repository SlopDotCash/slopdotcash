-- A completed value attempt that made no provider call can settle at zero cost.
-- Preserve every existing reconciliation and its immutable history.
CREATE TABLE slopbot_reconciliations_0120_copy AS SELECT * FROM slopbot_value_budget_reconciliations;
DROP TABLE slopbot_value_budget_reconciliations;
CREATE TABLE slopbot_value_budget_reconciliations (
 attempt_id TEXT PRIMARY KEY REFERENCES slopbot_value_budget_reservations(attempt_id),
 call_count INTEGER NOT NULL CHECK(call_count >= 0),
 recorded_micro_usd INTEGER NOT NULL CHECK(recorded_micro_usd >= 0 AND recorded_micro_usd <= 9007199254740991),
 reconciled_at TEXT NOT NULL,
 CHECK(call_count > 0 OR recorded_micro_usd = 0)
) STRICT;
INSERT INTO slopbot_value_budget_reconciliations SELECT * FROM slopbot_reconciliations_0120_copy;
DROP TABLE slopbot_reconciliations_0120_copy;
CREATE TRIGGER slopbot_value_budget_reconciliations_immutable BEFORE UPDATE ON slopbot_value_budget_reconciliations
BEGIN SELECT RAISE(ABORT, 'budget reconciliation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reconciliations_no_delete BEFORE DELETE ON slopbot_value_budget_reconciliations
BEGIN SELECT RAISE(ABORT, 'budget reconciliation is immutable'); END;
CREATE TRIGGER slopbot_value_budget_reconciliations_no_replace BEFORE INSERT ON slopbot_value_budget_reconciliations
WHEN EXISTS(SELECT 1 FROM slopbot_value_budget_reconciliations WHERE attempt_id=NEW.attempt_id)
BEGIN SELECT RAISE(ABORT, 'budget reconciliation already exists'); END;

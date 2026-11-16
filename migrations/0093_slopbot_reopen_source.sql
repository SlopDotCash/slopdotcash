-- Bind a reopen to its signature-verified event, not the head at queue delivery.
-- Older receipts stay unbound; do not infer a historical maintainer decision.
ALTER TABLE slopbot_deliveries ADD COLUMN reopen_source TEXT
 CHECK (reopen_source IS NULL OR json_valid(reopen_source));
ALTER TABLE slopbot_deliveries ADD COLUMN reopen_confirmed_at TEXT;
CREATE TRIGGER slopbot_reopen_source_immutable BEFORE UPDATE OF reopen_source
 ON slopbot_deliveries WHEN OLD.reopen_source IS NOT NULL
 AND NEW.reopen_source IS NOT OLD.reopen_source
 BEGIN SELECT RAISE(ABORT, 'reopen source is immutable'); END;
CREATE TRIGGER slopbot_reopen_confirmation_immutable BEFORE UPDATE OF reopen_confirmed_at
 ON slopbot_deliveries WHEN OLD.reopen_confirmed_at IS NOT NULL
 AND NEW.reopen_confirmed_at IS NOT OLD.reopen_confirmed_at
 BEGIN SELECT RAISE(ABORT, 'reopen confirmation is immutable'); END;

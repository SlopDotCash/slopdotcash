-- BOT-10 requires the complete call record to be immutable, including its
-- installation, attribution, usage and reconciliation state. Corrections and
-- invoice reconciliation must append evidence rather than rewrite a call.
DROP TRIGGER slopbot_costs_immutable;
CREATE TRIGGER slopbot_costs_immutable BEFORE UPDATE ON slopbot_costs
BEGIN SELECT RAISE(ABORT, 'slopbot cost rows are immutable'); END;

-- Credits already reject updates. Deletion also changes the derived prepaid
-- balance and must not erase a deposit or refund from its history.
CREATE TRIGGER slopbot_credits_no_delete BEFORE DELETE ON slopbot_credits
BEGIN SELECT RAISE(ABORT, 'slopbot credits are append-only'); END;

-- SQLite REPLACE can bypass delete triggers when recursive triggers are off.
-- Reject replacement at insertion, independent of that connection setting.
CREATE TRIGGER slopbot_costs_no_replace BEFORE INSERT ON slopbot_costs
WHEN EXISTS (SELECT 1 FROM slopbot_costs WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'slopbot cost rows cannot be replaced'); END;
CREATE TRIGGER slopbot_credits_no_replace BEFORE INSERT ON slopbot_credits
WHEN EXISTS (
 SELECT 1 FROM slopbot_credits WHERE id = NEW.id OR reference = NEW.reference
)
BEGIN SELECT RAISE(ABORT, 'slopbot credits cannot be replaced'); END;

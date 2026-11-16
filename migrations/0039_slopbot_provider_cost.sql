-- Provider-reported request cost is evidence for later reconciliation. It does
-- not replace the versioned price or mark an invoice finalized.
ALTER TABLE slopbot_costs ADD COLUMN provider_cost_micro_usd INTEGER
 CHECK(provider_cost_micro_usd IS NULL OR provider_cost_micro_usd >= 0);
CREATE TRIGGER slopbot_provider_cost_immutable BEFORE UPDATE ON slopbot_costs
WHEN NEW.provider_cost_micro_usd IS NOT OLD.provider_cost_micro_usd
BEGIN SELECT RAISE(ABORT, 'slopbot provider cost is immutable'); END;

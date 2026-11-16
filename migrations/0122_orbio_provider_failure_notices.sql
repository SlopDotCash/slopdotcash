-- Include the primary gateway in new failure notices. Retain existing claims
-- and receipts; historical failures do not become a new notification backlog.
DROP TRIGGER slopbot_provider_failure_notice;
CREATE TRIGGER slopbot_provider_failure_notice AFTER INSERT ON slopbot_costs
WHEN NEW.provider IN ('orbio','surplus') AND NEW.outcome='failed'
BEGIN INSERT INTO slopbot_provider_failure_notices(call_id) VALUES (NEW.id); END;

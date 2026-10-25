-- Queue new failed requests only. Historical costs remain unchanged and do not
-- become a new email backlog. A claim without a receipt is an unknown send.
CREATE TABLE slopbot_provider_failure_notices (
 call_id INTEGER PRIMARY KEY REFERENCES slopbot_costs(id),
 claimed_at TEXT
) STRICT;
CREATE TRIGGER slopbot_provider_failure_notice AFTER INSERT ON slopbot_costs
WHEN NEW.provider='surplus' AND NEW.outcome='failed'
BEGIN INSERT INTO slopbot_provider_failure_notices(call_id) VALUES (NEW.id); END;
CREATE TABLE slopbot_provider_failure_receipts (
 call_id INTEGER PRIMARY KEY REFERENCES slopbot_provider_failure_notices(call_id),
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','ambiguous')),
 recorded_at TEXT NOT NULL
) STRICT;

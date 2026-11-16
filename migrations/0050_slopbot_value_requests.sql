-- Durable identifiers for SCR-06. Receiving an event is not an assessment.
CREATE TABLE slopbot_value_requests (
 delivery_id TEXT PRIMARY KEY REFERENCES slopbot_deliveries(delivery_id),
 installation_id INTEGER NOT NULL CHECK(installation_id > 0),
 repository_id INTEGER NOT NULL CHECK(repository_id > 0),
 owner TEXT NOT NULL,
 repo TEXT NOT NULL,
 pull_request_number INTEGER NOT NULL CHECK(pull_request_number > 0),
 received_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER slopbot_value_requests_no_update BEFORE UPDATE ON slopbot_value_requests
BEGIN SELECT RAISE(ABORT, 'value requests are immutable'); END;
CREATE TRIGGER slopbot_value_requests_no_delete BEFORE DELETE ON slopbot_value_requests
BEGIN SELECT RAISE(ABORT, 'value requests are immutable'); END;
CREATE TRIGGER slopbot_value_requests_no_replace BEFORE INSERT ON slopbot_value_requests
WHEN EXISTS(SELECT 1 FROM slopbot_value_requests WHERE delivery_id=NEW.delivery_id)
BEGIN SELECT RAISE(ABORT, 'value request already exists'); END;

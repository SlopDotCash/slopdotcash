-- A receipt remains pending until queue dispatch completes. The claim serializes
-- concurrent redeliveries without treating an in-flight send as processed; a
-- failed sender releases it, and an abandoned claim expires for recovery.
ALTER TABLE slopbot_deliveries ADD COLUMN dispatch_claim_token TEXT;
ALTER TABLE slopbot_deliveries ADD COLUMN dispatch_claim_expires_at TEXT;

CREATE INDEX slopbot_deliveries_dispatch_claim
ON slopbot_deliveries(dispatch_claim_expires_at)
WHERE processed_at IS NULL;

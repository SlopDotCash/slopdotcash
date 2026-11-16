-- A joint assessment may overlap a different PR's request. Reserve all source
-- identities together before inference; operational leases are not score records.
CREATE TABLE slopbot_value_source_leases (
 scope_key TEXT PRIMARY KEY,
 delivery_id TEXT NOT NULL REFERENCES slopbot_value_requests(delivery_id),
 claim_token TEXT NOT NULL,
 lease_until TEXT NOT NULL
) STRICT;

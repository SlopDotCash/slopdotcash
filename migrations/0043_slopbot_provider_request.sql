-- Private receipt linkage, not a public artifact or invoice reconciliation.
-- Earlier calls remain null; never infer request identity from amount/time.
ALTER TABLE slopbot_costs ADD COLUMN provider_request_id TEXT
 CHECK(provider_request_id IS NULL OR (
   length(provider_request_id) BETWEEN 1 AND 128
   AND provider_request_id NOT GLOB '*[^A-Za-z0-9_-]*'
 ));

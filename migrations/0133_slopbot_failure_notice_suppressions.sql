-- Operator decision, 17 November 2026: a failed provider call sends no email
-- when a later call in the same route served the same job, or when an email for
-- the same model and cause was accepted in the previous six hours. A
-- suppressed notice is claimed and recorded here, never sent later.
CREATE TABLE slopbot_provider_failure_suppressions (
 call_id INTEGER PRIMARY KEY REFERENCES slopbot_provider_failure_notices(call_id),
 reason TEXT NOT NULL CHECK(reason IN ('served-by-fallback','repeat-within-6h')),
 recorded_at TEXT NOT NULL
) STRICT;
-- The fallback check looks up later calls of the same job.
CREATE INDEX slopbot_costs_review_call ON slopbot_costs(review_key, call_kind, id);

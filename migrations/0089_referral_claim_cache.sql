-- Read-only chain projection for the self-service referral claim flow (PRD 11).
-- A failed refresh retains the last successful snapshot. No key or signed bytes.
CREATE TABLE referral_claim_cache (
  id TEXT PRIMARY KEY CHECK (id = 'program'),
  body TEXT CHECK (body IS NULL OR json_valid(body)),
  observed_at TEXT,
  error_at TEXT,
  CHECK ((body IS NULL) = (observed_at IS NULL))
) STRICT;

-- Only the trusted renewal workflow writes this operational observation.
CREATE TABLE IF NOT EXISTS private_intake_status (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  verified_at TEXT NOT NULL
);

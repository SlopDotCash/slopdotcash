-- Scanner lease for a pending assessment the queue has already served.
-- Stale-pin recovery (#1411 C-01) must not terminalize an in-flight scan as
-- incomplete: that discarded confirmed-malicious results (#1789 P1). A separate
-- claims table avoids fighting the result-once trigger on vetting_assessments.
-- Unclaimed rows, and rows whose lease has expired, still recover.
CREATE TABLE vetting_assessment_claims (
  assessment_id TEXT PRIMARY KEY REFERENCES vetting_assessments(id),
  claimed_at TEXT NOT NULL,
  lease_until TEXT NOT NULL
) STRICT;

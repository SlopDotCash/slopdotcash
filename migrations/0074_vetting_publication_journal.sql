-- Durable metadata for the protected scanner controller. No evidence bodies.
CREATE TABLE vetting_publication_intents (
  assessment_id TEXT PRIMARY KEY REFERENCES vetting_assessments(id),
  result_sha256 TEXT NOT NULL CHECK(length(result_sha256)=64),
  origin TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('clean','incomplete','malicious')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE vetting_publication_receipts (
  assessment_id TEXT PRIMARY KEY REFERENCES vetting_publication_intents(assessment_id),
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','rejected','unknown')),
  http_status INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER vetting_publication_intents_no_update BEFORE UPDATE ON vetting_publication_intents BEGIN SELECT RAISE(ABORT,'Publication intents are immutable'); END;
CREATE TRIGGER vetting_publication_intents_no_delete BEFORE DELETE ON vetting_publication_intents BEGIN SELECT RAISE(ABORT,'Publication intents are immutable'); END;
CREATE TRIGGER vetting_publication_receipts_no_update BEFORE UPDATE ON vetting_publication_receipts BEGIN SELECT RAISE(ABORT,'Publication receipts are immutable'); END;
CREATE TRIGGER vetting_publication_receipts_no_delete BEFORE DELETE ON vetting_publication_receipts BEGIN SELECT RAISE(ABORT,'Publication receipts are immutable'); END;

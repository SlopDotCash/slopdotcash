-- Owner decision, 28 October 2026: scanner evidence has no object or run size
-- limit. New evidence objects are stored once in R2 under their SHA-256
-- (`vetting/objects/<sha256>`) and every run that declares the same digest
-- references that copy. `object_key` stays the unique per-row identity;
-- `storage` says where the bytes live. Existing rows keep run-scoped storage.
ALTER TABLE vetting_evidence_objects
  ADD COLUMN storage TEXT NOT NULL DEFAULT 'run' CHECK(storage IN ('run','content'));
CREATE INDEX vetting_evidence_objects_content
  ON vetting_evidence_objects(sha256) WHERE storage='content';

-- The single retention consumer claims a digest before deleting R2 bytes.
-- Registration is one D1 transaction: either its reference wins first, or
-- this trigger refuses it until deletion and its receipt finish together.
CREATE TABLE vetting_evidence_cleanup_claims (
  sha256 TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE
) STRICT;
CREATE TRIGGER vetting_evidence_registration_during_cleanup
BEFORE INSERT ON vetting_evidence_objects
WHEN NEW.storage='content' AND EXISTS (
  SELECT 1 FROM vetting_evidence_cleanup_claims WHERE sha256=NEW.sha256
)
BEGIN
  SELECT RAISE(ABORT, 'evidence cleanup in progress');
END;

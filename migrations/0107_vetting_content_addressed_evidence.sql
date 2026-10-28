-- Owner decision, 28 October 2026: scanner evidence has no object or run size
-- limit. New evidence objects are stored once in R2 under their SHA-256
-- (`vetting/objects/<sha256>`) and every run that declares the same digest
-- references that copy. `object_key` stays the unique per-row identity;
-- `storage` says where the bytes live. Existing rows keep run-scoped storage.
ALTER TABLE vetting_evidence_objects
  ADD COLUMN storage TEXT NOT NULL DEFAULT 'run' CHECK(storage IN ('run','content'));
CREATE INDEX vetting_evidence_objects_content
  ON vetting_evidence_objects(sha256) WHERE storage='content';

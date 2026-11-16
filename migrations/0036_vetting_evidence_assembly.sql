-- Existing receipts remain immutable and receive no inferred assembly.
ALTER TABLE vetting_evidence_runs ADD COLUMN assembly_sha256 TEXT
  CHECK(assembly_sha256 IS NULL OR (length(assembly_sha256)=64 AND assembly_sha256 NOT GLOB '*[^0-9a-f]*'));

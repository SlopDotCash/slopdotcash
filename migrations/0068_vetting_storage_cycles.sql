-- A single durable cycle keeps backup copying and source deletion separate.
CREATE TABLE vetting_storage_cycles (
  day TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('backup','cleanup','complete')),
  finished_at TEXT,
  cleanup_after TEXT
) STRICT;
CREATE UNIQUE INDEX vetting_storage_one_active_cycle
ON vetting_storage_cycles((1)) WHERE phase <> 'complete';
CREATE TABLE vetting_evidence_deletions (
  assessment_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY(assessment_id,run_id,sha256),
  FOREIGN KEY(assessment_id,run_id,sha256)
    REFERENCES vetting_evidence_objects(assessment_id,run_id,sha256)
) STRICT;
CREATE TRIGGER vetting_evidence_deletions_no_update
BEFORE UPDATE ON vetting_evidence_deletions
BEGIN SELECT RAISE(ABORT, 'evidence deletion receipt is immutable'); END;
CREATE TRIGGER vetting_evidence_deletions_no_delete
BEFORE DELETE ON vetting_evidence_deletions
BEGIN SELECT RAISE(ABORT, 'evidence deletion receipt is permanent'); END;

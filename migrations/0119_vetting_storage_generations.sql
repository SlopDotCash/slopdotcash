-- Immutable physical generations isolate new evidence from retired keys.
-- Existing null-generation rows retain their original locations and are held
-- from automatic physical cleanup until old writers are independently drained.
CREATE TABLE vetting_evidence_generations (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 100 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  state TEXT NOT NULL CHECK(state IN ('active','retiring','retired')),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  CHECK((state='retired')=(retired_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX vetting_evidence_one_active_generation
ON vetting_evidence_generations(sha256) WHERE state='active';
ALTER TABLE vetting_evidence_objects ADD COLUMN storage_generation TEXT
  REFERENCES vetting_evidence_generations(id);
CREATE INDEX vetting_evidence_generation_references
ON vetting_evidence_objects(storage_generation);

DROP TRIGGER vetting_evidence_registration_during_cleanup;
CREATE TRIGGER vetting_evidence_registration_generation
BEFORE INSERT ON vetting_evidence_objects
WHEN (NEW.storage='content' AND NEW.storage_generation IS NULL)
  OR (NEW.storage_generation IS NOT NULL AND (
    NEW.storage<>'content' OR NOT EXISTS (
      SELECT 1 FROM vetting_evidence_generations g
      WHERE g.id=NEW.storage_generation AND g.sha256=NEW.sha256 AND g.state='active'
    )
  ))
BEGIN SELECT RAISE(ABORT,'evidence generation is not active'); END;

CREATE TABLE vetting_evidence_targets (
  target_key TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES vetting_evidence_generations(id),
  part_index INTEGER NOT NULL CHECK(part_index>=-1),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0 AND size_bytes<=8388608),
  created_at TEXT NOT NULL,
  CHECK(substr(target_key,1,length('vetting/generations/'||generation_id||'/'))='vetting/generations/'||generation_id||'/'
    AND length(substr(target_key,length('vetting/generations/'||generation_id||'/')+1)) BETWEEN 1 AND 100
    AND substr(target_key,length('vetting/generations/'||generation_id||'/')+1) NOT GLOB '*[^A-Za-z0-9_-]*')
) STRICT;
CREATE INDEX vetting_evidence_generation_targets
ON vetting_evidence_targets(generation_id,target_key);
CREATE TABLE vetting_evidence_heads (
  generation_id TEXT NOT NULL REFERENCES vetting_evidence_generations(id),
  part_index INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  target_key TEXT NOT NULL UNIQUE REFERENCES vetting_evidence_targets(target_key),
  PRIMARY KEY(generation_id,part_index,sha256,size_bytes)
) STRICT;
CREATE TABLE vetting_evidence_target_retirements (
  target_key TEXT PRIMARY KEY REFERENCES vetting_evidence_targets(target_key),
  outcome TEXT NOT NULL CHECK(outcome IN ('backed','changed','missing')),
  backup_day TEXT NOT NULL,
  backup_key TEXT,
  observed_sha256 TEXT,
  observed_size_bytes INTEGER,
  observed_at TEXT NOT NULL,
  CHECK((outcome='missing' AND backup_key IS NULL AND observed_sha256 IS NULL AND observed_size_bytes IS NULL)
    OR (outcome IN ('backed','changed') AND backup_key IS NOT NULL AND length(observed_sha256)=64
      AND observed_size_bytes BETWEEN 0 AND 8388608))
) STRICT;

CREATE TRIGGER vetting_evidence_target_reservation
BEFORE INSERT ON vetting_evidence_targets
WHEN NOT EXISTS (SELECT 1 FROM vetting_evidence_generations
  WHERE id=NEW.generation_id AND state='active')
BEGIN SELECT RAISE(ABORT,'evidence generation is not active'); END;
CREATE TRIGGER vetting_evidence_targets_no_update
BEFORE UPDATE ON vetting_evidence_targets
BEGIN SELECT RAISE(ABORT,'immutable evidence target'); END;
CREATE TRIGGER vetting_evidence_targets_no_delete
BEFORE DELETE ON vetting_evidence_targets
BEGIN SELECT RAISE(ABORT,'evidence target history is permanent'); END;
CREATE TRIGGER vetting_evidence_head_insert
BEFORE INSERT ON vetting_evidence_heads
WHEN NOT EXISTS (
  SELECT 1 FROM vetting_evidence_targets t JOIN vetting_evidence_generations g ON g.id=t.generation_id
  WHERE t.target_key=NEW.target_key AND t.generation_id=NEW.generation_id
    AND t.part_index=NEW.part_index AND t.sha256=NEW.sha256 AND t.size_bytes=NEW.size_bytes AND g.state='active'
)
BEGIN SELECT RAISE(ABORT,'evidence head is outside active generation'); END;
CREATE TRIGGER vetting_evidence_head_update
BEFORE UPDATE ON vetting_evidence_heads
WHEN OLD.generation_id<>NEW.generation_id OR OLD.part_index<>NEW.part_index
  OR OLD.sha256<>NEW.sha256 OR OLD.size_bytes<>NEW.size_bytes OR NOT EXISTS (
    SELECT 1 FROM vetting_evidence_targets t JOIN vetting_evidence_generations g ON g.id=t.generation_id
    WHERE t.target_key=NEW.target_key AND t.generation_id=NEW.generation_id
      AND t.part_index=NEW.part_index AND t.sha256=NEW.sha256 AND t.size_bytes=NEW.size_bytes AND g.state='active'
  )
BEGIN SELECT RAISE(ABORT,'evidence head is outside active generation'); END;
CREATE TRIGGER vetting_evidence_heads_no_delete
BEFORE DELETE ON vetting_evidence_heads
BEGIN SELECT RAISE(ABORT,'evidence head history is permanent'); END;
CREATE TRIGGER vetting_evidence_target_retirement_insert
BEFORE INSERT ON vetting_evidence_target_retirements
WHEN NOT EXISTS (
  SELECT 1 FROM vetting_evidence_targets t JOIN vetting_evidence_generations g ON g.id=t.generation_id
  WHERE t.target_key=NEW.target_key AND g.state='retiring'
    AND (NEW.outcome='missing'
      OR (NEW.outcome='backed' AND NEW.observed_sha256=t.sha256 AND NEW.observed_size_bytes=t.size_bytes)
      OR (NEW.outcome='changed' AND (NEW.observed_sha256<>t.sha256 OR NEW.observed_size_bytes<>t.size_bytes)))
)
BEGIN SELECT RAISE(ABORT,'evidence generation is not retiring'); END;
CREATE TRIGGER vetting_evidence_target_retirements_no_update
BEFORE UPDATE ON vetting_evidence_target_retirements
BEGIN SELECT RAISE(ABORT,'immutable evidence retirement'); END;
CREATE TRIGGER vetting_evidence_target_retirements_no_delete
BEFORE DELETE ON vetting_evidence_target_retirements
BEGIN SELECT RAISE(ABORT,'evidence retirement history is permanent'); END;
CREATE TRIGGER vetting_evidence_generations_transition
BEFORE UPDATE ON vetting_evidence_generations
WHEN OLD.id<>NEW.id OR OLD.sha256<>NEW.sha256 OR OLD.created_at<>NEW.created_at
  OR NOT ((OLD.state='active' AND NEW.state='retiring' AND NEW.retired_at IS NULL)
    OR (OLD.state='retiring' AND NEW.state='retired' AND NEW.retired_at IS NOT NULL))
  OR (NEW.state='retired' AND EXISTS (
    SELECT 1 FROM vetting_evidence_targets t WHERE t.generation_id=NEW.id
      AND NOT EXISTS (SELECT 1 FROM vetting_evidence_target_retirements r WHERE r.target_key=t.target_key)
  ))
BEGIN SELECT RAISE(ABORT,'invalid evidence generation transition'); END;
CREATE TRIGGER vetting_evidence_generations_no_delete
BEFORE DELETE ON vetting_evidence_generations
BEGIN SELECT RAISE(ABORT,'evidence generation history is permanent'); END;

-- An old Worker cannot publish a misleading deletion receipt for the new
-- protocol, including when some declared slots never acquired backed bytes.
CREATE TRIGGER vetting_evidence_generation_deletion
BEFORE INSERT ON vetting_evidence_deletions
WHEN EXISTS (
  SELECT 1 FROM vetting_evidence_objects o
  WHERE o.assessment_id=NEW.assessment_id AND o.run_id=NEW.run_id AND o.sha256=NEW.sha256
    AND o.storage_generation IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM vetting_evidence_generations g WHERE g.id=o.storage_generation AND g.state='retired')
      OR (o.chunks IS NULL AND NOT EXISTS (
        SELECT 1 FROM vetting_evidence_heads h JOIN vetting_evidence_target_retirements r ON r.target_key=h.target_key
        WHERE h.generation_id=o.storage_generation AND h.part_index=-1 AND h.sha256=o.sha256
          AND h.size_bytes=o.size_bytes AND r.outcome='backed'
      ))
      OR (o.chunks IS NOT NULL AND EXISTS (
        SELECT 1 FROM json_each(o.chunks) c WHERE NOT EXISTS (
          SELECT 1 FROM vetting_evidence_heads h JOIN vetting_evidence_target_retirements r ON r.target_key=h.target_key
          WHERE h.generation_id=o.storage_generation AND h.part_index=json_extract(c.value,'$.index')
            AND h.sha256=json_extract(c.value,'$.sha256') AND h.size_bytes=json_extract(c.value,'$.sizeBytes') AND r.outcome='backed'
        )
      ))
    )
)
BEGIN SELECT RAISE(ABORT,'evidence generation is not backed and retired'); END;

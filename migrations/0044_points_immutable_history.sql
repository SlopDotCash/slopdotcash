-- Preserve completed Points history under SQLite REPLACE semantics, which can
-- bypass ordinary delete triggers. Exact replay remains valid for batch imports.
CREATE TRIGGER points_revision_no_replacement BEFORE INSERT ON points_revisions
BEGIN
 SELECT RAISE(ABORT, 'points revision is immutable') WHERE EXISTS (
  SELECT 1 FROM points_revisions r WHERE r.id = NEW.id AND (
   r.source_key IS NOT NEW.source_key OR r.previous IS NOT NEW.previous OR
   r.recorded_at IS NOT NEW.recorded_at OR r.payload IS NOT NEW.payload
  )
 );
 SELECT RAISE(ABORT, 'points root is immutable') WHERE NEW.previous IS NULL AND EXISTS (
  SELECT 1 FROM points_revisions r
  WHERE r.source_key = NEW.source_key AND r.previous IS NULL AND r.id != NEW.id
 );
 SELECT RAISE(ABORT, 'points successor cannot branch') WHERE NEW.previous IS NOT NULL AND EXISTS (
  SELECT 1 FROM points_revisions r WHERE r.previous = NEW.previous AND r.id != NEW.id
 );
END;
CREATE TRIGGER points_batch_no_replacement BEFORE INSERT ON points_batches
BEGIN
 SELECT RAISE(ABORT, 'completed points batch is immutable') WHERE EXISTS (
  SELECT 1 FROM points_batches b WHERE b.digest = NEW.digest AND (
   b.generated_at IS NOT NEW.generated_at OR b.coverage IS NOT NEW.coverage OR
   b.revision_count IS NOT NEW.revision_count
  )
 );
END;
CREATE TRIGGER points_batch_no_update BEFORE UPDATE ON points_batches
BEGIN SELECT RAISE(ABORT, 'completed points batch is immutable'); END;
CREATE TRIGGER points_batch_no_delete BEFORE DELETE ON points_batches
BEGIN SELECT RAISE(ABORT, 'completed points batch is immutable'); END;

-- Public journal pages use permanent row order. A completed batch must name
-- that exact prefix, not merely the same set and count of revisions.
DROP TRIGGER points_complete_batch;
CREATE TRIGGER points_complete_batch BEFORE INSERT ON points_batches
BEGIN
 SELECT RAISE(ABORT, 'incomplete points upload') WHERE (SELECT COUNT(*) FROM points_staging WHERE batch_id=NEW.digest) != NEW.revision_count;
 SELECT RAISE(ABORT, 'divergent points batch') WHERE EXISTS (
   SELECT 1 FROM (
     SELECT id, ROW_NUMBER() OVER (ORDER BY rowid) - 1 AS sequence FROM points_revisions
   ) r LEFT JOIN points_staging s ON s.batch_id=NEW.digest AND s.sequence=r.sequence
   WHERE s.payload IS NULL OR json_extract(s.payload,'$.id') != r.id
 );
 SELECT RAISE(ABORT, 'conflicting points revision') WHERE EXISTS (
   SELECT 1 FROM points_staging s JOIN points_revisions r ON r.id=json_extract(s.payload,'$.id')
   WHERE s.batch_id=NEW.digest AND s.payload != r.payload
 );
 INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload)
 SELECT json_extract(payload,'$.id'),json_extract(payload,'$.award.key'),json_extract(payload,'$.previous'),json_extract(payload,'$.recordedAt'),payload
 FROM points_staging WHERE batch_id=NEW.digest ORDER BY sequence
 ON CONFLICT(id) DO NOTHING;
 SELECT RAISE(ABORT, 'divergent points batch') WHERE NEW.revision_count != (SELECT COUNT(*) FROM points_revisions);
END;

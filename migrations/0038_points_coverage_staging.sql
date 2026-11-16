-- Coverage gains one entry per repository with every snapshot, so a batch
-- statement that carries it inline outgrows D1's 100 KB statement limit.
-- Stage the entries like revisions; the batch statement assembles them.
CREATE TABLE points_coverage_staging (
 batch_id TEXT NOT NULL, sequence INTEGER NOT NULL, entry TEXT NOT NULL CHECK(json_valid(entry)),
 PRIMARY KEY(batch_id,sequence)
) STRICT;
CREATE TRIGGER points_clear_coverage_staging AFTER INSERT ON points_batches
BEGIN DELETE FROM points_coverage_staging WHERE batch_id=NEW.digest; END;

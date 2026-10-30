-- Preserve a known source gap while its automatic retry is running or blocked.
ALTER TABLE slopbot_value_processing ADD COLUMN incomplete_since TEXT;
UPDATE slopbot_value_processing SET incomplete_since = updated_at
 WHERE outcome = 'source-incomplete';
CREATE INDEX slopbot_value_processing_incomplete
 ON slopbot_value_processing(incomplete_since) WHERE incomplete_since IS NOT NULL;

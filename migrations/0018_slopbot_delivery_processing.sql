ALTER TABLE slopbot_installations ADD COLUMN source_updated_at INTEGER;

UPDATE slopbot_installations
SET source_updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;

ALTER TABLE slopbot_deliveries ADD COLUMN installation_processed_at TEXT;

UPDATE slopbot_deliveries
SET installation_processed_at = received_at
WHERE event = 'installation';

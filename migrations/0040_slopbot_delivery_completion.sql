-- Receiving a webhook is not proof that the queue accepted its job. Leave
-- incomplete receipts retryable when GitHub redelivers the same delivery ID.
-- Existing receipts have no dispatch evidence; consumers deduplicate any replay.
ALTER TABLE slopbot_deliveries ADD COLUMN processed_at TEXT;

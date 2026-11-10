-- Unsubscribe capabilities are no longer permanent. Each issued token
-- carries an expiry and is spent on first use; every mail issues a fresh
-- random token, so a later mail never revives a spent one.
-- Existing rows get a bounded life of 30 days from their first issue.
--
-- Order matters: the 0111 no-update trigger aborts ANY update on this
-- table, so it must go before the backfill runs, and the new trigger must
-- come after — its expires_at guard would abort the backfill too (NULL to
-- a value). ALTERs -> DROP old trigger -> backfill -> CREATE new trigger.
ALTER TABLE notification_email_unsubscribe_tokens ADD COLUMN expires_at TEXT;
ALTER TABLE notification_email_unsubscribe_tokens ADD COLUMN consumed_at TEXT;
DROP TRIGGER notification_email_unsubscribe_no_update;
UPDATE notification_email_unsubscribe_tokens
SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', issued_at, '+30 days')
WHERE expires_at IS NULL;

-- The identity of an issued capability (hash, destination, first issue)
-- stays immutable, and so does its lifecycle: expiry never moves and a
-- spend is one-way. Issuing a fresh token inserts a new row; no update
-- may revive a spent token or extend a dead one.
CREATE TRIGGER notification_email_unsubscribe_no_update BEFORE UPDATE ON notification_email_unsubscribe_tokens
WHEN NEW.token_hash<>OLD.token_hash
  OR NEW.destination_version<>OLD.destination_version
  OR NEW.issued_at<>OLD.issued_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'issued unsubscribe capabilities are immutable'); END;

-- Unsubscribe capabilities are no longer permanent. Each issued token
-- carries an expiry and is spent on first use; a fresh mail re-issues
-- (renews) the same deterministic token for its destination version.
-- Existing rows get a bounded life of 30 days from their first issue.
ALTER TABLE notification_email_unsubscribe_tokens ADD COLUMN expires_at TEXT;
ALTER TABLE notification_email_unsubscribe_tokens ADD COLUMN consumed_at TEXT;
UPDATE notification_email_unsubscribe_tokens
SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ', issued_at, '+30 days')
WHERE expires_at IS NULL;

-- The identity of an issued capability (hash, destination, first issue)
-- stays immutable. Only its lifecycle may move: expiry refreshes forward
-- on re-issue, and consumption is a one-way spend until a re-issue renews
-- it. No other update is permitted.
DROP TRIGGER notification_email_unsubscribe_no_update;
CREATE TRIGGER notification_email_unsubscribe_no_update BEFORE UPDATE ON notification_email_unsubscribe_tokens
WHEN NEW.token_hash<>OLD.token_hash
  OR NEW.destination_version<>OLD.destination_version
  OR NEW.issued_at<>OLD.issued_at
  OR (OLD.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at<OLD.expires_at))
BEGIN SELECT RAISE(ABORT,'issued unsubscribe capabilities are immutable'); END;

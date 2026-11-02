-- Every preference save, including an idempotent unsubscribe, invalidates an
-- earlier consent read. Timestamps and values can repeat during concurrent saves.
ALTER TABLE notification_email_preferences ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);

CREATE TRIGGER notification_email_preference_revision
AFTER UPDATE OF enabled,security_enabled,destination_version ON notification_email_preferences
BEGIN
  UPDATE notification_email_preferences SET revision=revision+1 WHERE github_id=NEW.github_id;
END;

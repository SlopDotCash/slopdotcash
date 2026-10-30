-- Private, user-verified destinations. Verification tokens are hash-only;
-- consent and each queued notice bind one immutable destination version.
ALTER TABLE notification_email_preferences ADD COLUMN security_enabled INTEGER
  CHECK (security_enabled IS NULL OR security_enabled IN (0,1));

CREATE TABLE notification_email_destinations (
  github_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  destination_version TEXT NOT NULL UNIQUE CHECK(length(destination_version)=64),
  verified_at TEXT NOT NULL
) STRICT;

CREATE TABLE notification_email_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  github_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  email TEXT NOT NULL,
  address_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  activity_enabled INTEGER NOT NULL CHECK(activity_enabled IN (0,1)),
  security_enabled INTEGER NOT NULL CHECK(security_enabled IN (0,1)),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','unknown')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cancelled_at TEXT,
  consumed_at TEXT,
  destination_version TEXT,
  UNIQUE(github_id,request_key)
) STRICT;
CREATE INDEX notification_email_verification_actor ON notification_email_verifications(github_id,created_at);
CREATE INDEX notification_email_verification_address ON notification_email_verifications(address_key,created_at);

-- Issued capabilities survive signing-key rotation without keeping old keys.
-- They only disable consent while their exact address version is current.
CREATE TABLE notification_email_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
  destination_version TEXT NOT NULL CHECK(length(destination_version)=64),
  issued_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER notification_email_unsubscribe_no_update BEFORE UPDATE ON notification_email_unsubscribe_tokens
BEGIN SELECT RAISE(ABORT,'issued unsubscribe capabilities are immutable'); END;
CREATE TRIGGER notification_email_unsubscribe_no_delete BEFORE DELETE ON notification_email_unsubscribe_tokens
BEGIN SELECT RAISE(ABORT,'issued unsubscribe capabilities are permanent'); END;

ALTER TABLE security_notification_outbox ADD COLUMN destination_version TEXT;
CREATE TRIGGER security_email_destination_version AFTER INSERT ON security_notification_outbox
BEGIN
  UPDATE security_notification_outbox SET destination_version=(
    SELECT d.destination_version FROM notification_email_destinations d
    JOIN notification_email_preferences p ON p.github_id=d.github_id
    WHERE d.github_id=NEW.recipient_github_id AND p.security_enabled=1
      AND p.destination_version=d.destination_version
  ) WHERE id=NEW.id;
END;
CREATE TRIGGER security_email_opt_out AFTER UPDATE ON notification_email_preferences
WHEN NEW.security_enabled=0
BEGIN
  UPDATE security_notification_outbox SET state='suppressed',updated_at=NEW.updated_at
  WHERE recipient_github_id=NEW.github_id AND state IN ('queued','retrying');
  UPDATE activity_notification_outbox SET state='suppressed',updated_at=NEW.updated_at
  WHERE recipient_github_id=NEW.github_id AND essential=1 AND state IN ('queued','retrying');
END;
CREATE TRIGGER essential_email_destination_version AFTER INSERT ON activity_notification_outbox
WHEN NEW.essential=1
BEGIN
  UPDATE activity_notification_outbox SET destination_version=(
    SELECT d.destination_version FROM notification_email_destinations d
    JOIN notification_email_preferences p ON p.github_id=d.github_id
    WHERE d.github_id=NEW.recipient_github_id AND p.security_enabled=1
      AND p.destination_version=d.destination_version
  ) WHERE id=NEW.id AND EXISTS(SELECT 1 FROM notification_email_destinations WHERE github_id=NEW.recipient_github_id);
END;

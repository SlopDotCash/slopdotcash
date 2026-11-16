-- NOT-01: preference binds consent to one operator-verified destination version.
CREATE TABLE notification_email_preferences (
  github_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  destination_version TEXT,
  updated_at TEXT NOT NULL,
  CHECK(enabled = 0 OR length(destination_version) = 64)
) STRICT;
CREATE TABLE activity_notification_outbox (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  event_key TEXT NOT NULL,
  recipient_github_id TEXT NOT NULL,
  template_version TEXT NOT NULL DEFAULT 'activity-inbox-v1',
  essential INTEGER NOT NULL CHECK(essential IN (0,1)),
  destination_version TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','retrying','sending','provider-accepted','delivered','bounced','suppressed','exhausted','ambiguous')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claimed_at TEXT,
  destination_digest TEXT,
  provider_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_key,recipient_github_id,template_version)
) STRICT;
CREATE INDEX activity_notification_ready ON activity_notification_outbox(state,next_attempt_at);
CREATE TABLE activity_notification_delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL REFERENCES activity_notification_outbox(id),
  state TEXT NOT NULL,
  evidence_reference TEXT,
  attempt INTEGER,
  destination_digest TEXT,
  at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX activity_notification_evidence_once ON activity_notification_delivery_events(evidence_reference) WHERE evidence_reference IS NOT NULL;
CREATE TRIGGER activity_notification_event_no_update BEFORE UPDATE ON activity_notification_delivery_events
BEGIN SELECT RAISE(ABORT,'delivery evidence is append-only'); END;
CREATE TRIGGER activity_notification_event_no_delete BEFORE DELETE ON activity_notification_delivery_events
BEGIN SELECT RAISE(ABORT,'delivery evidence is append-only'); END;
CREATE TRIGGER activity_notification_enqueue AFTER INSERT ON notifications
WHEN NEW.kind <> 'security_case' AND (NEW.kind = 'wallet_changed' OR EXISTS (
  SELECT 1 FROM notification_email_preferences WHERE github_id=NEW.recipient_github_id AND enabled=1
))
BEGIN
  INSERT INTO activity_notification_outbox(event_key,recipient_github_id,essential,destination_version,next_attempt_at,created_at,updated_at)
  VALUES(NEW.event_key,NEW.recipient_github_id,CASE NEW.kind WHEN 'wallet_changed' THEN 1 ELSE 0 END,
    (SELECT destination_version FROM notification_email_preferences WHERE github_id=NEW.recipient_github_id AND enabled=1),
    NEW.created_at,NEW.created_at,NEW.created_at)
  ON CONFLICT(event_key,recipient_github_id,template_version) DO NOTHING;
END;
-- No history is mailed on opt-in. Only later source events can enqueue.
CREATE TRIGGER activity_email_opt_out AFTER UPDATE ON notification_email_preferences
WHEN NEW.enabled=0
BEGIN
  UPDATE activity_notification_outbox SET state='suppressed',updated_at=NEW.updated_at
    WHERE recipient_github_id=NEW.github_id AND essential=0 AND state IN ('queued','retrying');
END;

-- SEC-16: private delivery state. The inbox insert and its outbox row are one
-- transaction; a notification failure cannot lose or change the case receipt.
CREATE TABLE security_notification_outbox (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  event_key TEXT NOT NULL,
  recipient_github_id TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES security_cases(id),
  template_version TEXT NOT NULL DEFAULT 'security-inbox-v1',
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN
    ('queued','retrying','sending','provider-accepted','delivered','bounced','suppressed','exhausted','ambiguous')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claimed_at TEXT,
  destination_digest TEXT,
  provider_reference TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  escalation_checked_at TEXT,
  escalation_of TEXT REFERENCES security_notification_outbox(id),
  UNIQUE(event_key, recipient_github_id, template_version)
);
CREATE INDEX security_notification_ready ON security_notification_outbox(state, next_attempt_at);
CREATE TABLE security_notification_delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL REFERENCES security_notification_outbox(id),
  state TEXT NOT NULL,
  evidence_reference TEXT,
  attempt INTEGER,
  destination_digest TEXT,
  at TEXT NOT NULL
);
CREATE UNIQUE INDEX security_notification_evidence_once ON security_notification_delivery_events(evidence_reference) WHERE evidence_reference IS NOT NULL;
CREATE TRIGGER security_notification_event_no_update BEFORE UPDATE ON security_notification_delivery_events
BEGIN SELECT RAISE(ABORT, 'delivery evidence is append-only'); END;
CREATE TRIGGER security_notification_event_no_delete BEFORE DELETE ON security_notification_delivery_events
BEGIN SELECT RAISE(ABORT, 'delivery evidence is append-only'); END;
CREATE TRIGGER security_notification_enqueue AFTER INSERT ON notifications
WHEN NEW.kind = 'security_case'
BEGIN
  INSERT INTO security_notification_outbox(event_key, recipient_github_id, case_id, next_attempt_at, created_at, updated_at)
  VALUES(NEW.event_key, NEW.recipient_github_id, NEW.subject, NEW.created_at, NEW.created_at, NEW.created_at)
  ON CONFLICT(event_key, recipient_github_id, template_version) DO NOTHING;
END;
-- Existing inbox notices are deliberately not mailed retrospectively.

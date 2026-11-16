-- PRD sections 5 and 9: moderator Inbox notices for escalated public appeals.
-- Preserve prior notices and queue triggers without replaying historical email.
CREATE TABLE notifications_0065_copy (
  event_key TEXT, recipient_github_id TEXT, kind TEXT, subject TEXT,
  detail TEXT, action_path TEXT, source_at TEXT, created_at TEXT, read_at TEXT
) STRICT;
INSERT INTO notifications_0065_copy (
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at, read_at
)
SELECT
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at, read_at
FROM notifications;
DROP TRIGGER notifications_read_once;
DROP TRIGGER notifications_no_delete;
DROP TRIGGER security_notification_enqueue;
DROP TRIGGER activity_notification_enqueue;
DROP TABLE notifications;

CREATE TABLE notifications (
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 8 AND 300),
  recipient_github_id TEXT NOT NULL CHECK (
    length(recipient_github_id) BETWEEN 1 AND 20 AND
    recipient_github_id GLOB '[1-9]*' AND
    recipient_github_id NOT GLOB '*[^0-9]*'
  ),
  kind TEXT NOT NULL CHECK (kind IN (
    'application_approved', 'application_rejected', 'project_revision',
    'award_reserved', 'payment_paid', 'payout_held', 'wallet_changed',
    'project_quarantined', 'project_banned', 'reinstatement_requested',
    'project_reinstated', 'reinstatement_denied', 'reinstatement_review',
    'payout_exception', 'security_case',
    'project_ready', 'project_scan_failed', 'project_installation_lost',
    'security_report_received', 'slopbot_appeal_review'
  )),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
  detail TEXT CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 1000),
  action_path TEXT NOT NULL CHECK (
    length(action_path) BETWEEN 1 AND 200 AND
    action_path GLOB '/*' AND action_path NOT GLOB '//*'
  ),
  source_at TEXT NOT NULL CHECK (length(source_at) BETWEEN 20 AND 30),
  created_at TEXT NOT NULL,
  read_at TEXT,
  PRIMARY KEY (event_key, recipient_github_id)
) STRICT;

INSERT INTO notifications (
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at, read_at
)
SELECT
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at, read_at
FROM notifications_0065_copy;
DROP TABLE notifications_0065_copy;

CREATE INDEX notifications_recipient
  ON notifications(recipient_github_id, source_at DESC);

-- Only the read state changes, and only from unread to read.
CREATE TRIGGER notifications_read_once
BEFORE UPDATE ON notifications
WHEN NEW.event_key IS NOT OLD.event_key
  OR NEW.recipient_github_id IS NOT OLD.recipient_github_id
  OR NEW.kind IS NOT OLD.kind OR NEW.subject IS NOT OLD.subject
  OR NEW.detail IS NOT OLD.detail OR NEW.action_path IS NOT OLD.action_path
  OR NEW.source_at IS NOT OLD.source_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.read_at IS NOT NULL OR NEW.read_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'notifications change only from unread to read');
END;

CREATE TRIGGER notifications_no_delete
BEFORE DELETE ON notifications
BEGIN
  SELECT RAISE(ABORT, 'notifications are permanent');
END;

-- Private case notices keep their separate SEC-16 queue. A case notice that
-- asks a role holder to act uses the acknowledged template, with escalation
-- for a missed acknowledgment. A reporter's receipt is informational: it uses
-- its own template and never waits for an acknowledgment.
CREATE TRIGGER security_notification_enqueue AFTER INSERT ON notifications
WHEN NEW.kind IN ('security_case', 'security_report_received')
BEGIN
  INSERT INTO security_notification_outbox(event_key, recipient_github_id, case_id, template_version, next_attempt_at, created_at, updated_at)
  VALUES(NEW.event_key, NEW.recipient_github_id, NEW.subject,
    CASE NEW.kind WHEN 'security_report_received' THEN 'security-receipt-v1' ELSE 'security-inbox-v1' END,
    NEW.created_at, NEW.created_at, NEW.created_at)
  ON CONFLICT(event_key, recipient_github_id, template_version) DO NOTHING;
END;

-- Ordinary activity mail is optional (0033). Wallet changes stay essential.
CREATE TRIGGER activity_notification_enqueue AFTER INSERT ON notifications
WHEN NEW.kind NOT IN ('security_case', 'security_report_received') AND (NEW.kind = 'wallet_changed' OR EXISTS (
  SELECT 1 FROM notification_email_preferences WHERE github_id=NEW.recipient_github_id AND enabled=1
))
BEGIN
  INSERT INTO activity_notification_outbox(event_key,recipient_github_id,essential,destination_version,next_attempt_at,created_at,updated_at)
  VALUES(NEW.event_key,NEW.recipient_github_id,CASE NEW.kind WHEN 'wallet_changed' THEN 1 ELSE 0 END,
    (SELECT destination_version FROM notification_email_preferences WHERE github_id=NEW.recipient_github_id AND enabled=1),
    NEW.created_at,NEW.created_at,NEW.created_at)
  ON CONFLICT(event_key,recipient_github_id,template_version) DO NOTHING;
END;

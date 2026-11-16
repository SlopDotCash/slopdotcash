-- Widen the inbox kinds (PRD NOT-01) for the events of the project
-- enforcement path (0023), the private security cases (0026) and the
-- maintainer payout exception. SQLite cannot alter a CHECK in place, so the
-- table is rebuilt: copy every row aside into a plain holding table, drop the
-- original (triggers first), create the replacement under its own name with
-- the widened CHECK, re-insert every row, drop the holding table, and
-- recreate the index and triggers under their original names. No table
-- references notifications, so no foreign key is affected.

CREATE TABLE notifications_0029_copy (
  event_key TEXT, recipient_github_id TEXT, kind TEXT, subject TEXT,
  detail TEXT, action_path TEXT, source_at TEXT, created_at TEXT, read_at TEXT
) STRICT;
INSERT INTO notifications_0029_copy (
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at, read_at
)
SELECT
  event_key, recipient_github_id, kind, subject, detail, action_path,
  source_at, created_at, read_at
FROM notifications;
DROP TRIGGER notifications_read_once;
DROP TRIGGER notifications_no_delete;
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
    'payout_exception', 'security_case'
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
FROM notifications_0029_copy;
DROP TABLE notifications_0029_copy;

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

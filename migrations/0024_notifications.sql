-- In-app notification inbox (PRD NOT-01). Each row is one event for one
-- recipient. Each writer adds the row in the same D1 batch as its source
-- change (backend/notifications/events.ts), so an event is never lost and
-- never written for a change that did not commit. Writers do this instead of
-- an AFTER trigger because D1 counts trigger writes in meta.changes, which the
-- writers check. The (event_key, recipient) key makes every replay of the same
-- source event a no-op. No row carries a wallet address, a secret or a private
-- identity fact; the action path opens the page with the details.

CREATE TABLE notifications (
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 8 AND 300),
  recipient_github_id TEXT NOT NULL CHECK (
    length(recipient_github_id) BETWEEN 1 AND 20 AND
    recipient_github_id GLOB '[1-9]*' AND
    recipient_github_id NOT GLOB '*[^0-9]*'
  ),
  kind TEXT NOT NULL CHECK (kind IN (
    'application_approved', 'application_rejected', 'project_revision',
    'award_reserved', 'payment_paid', 'payout_held', 'wallet_changed'
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

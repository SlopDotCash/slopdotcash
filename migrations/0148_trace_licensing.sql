-- Port of main's 0148_trace_licensing.sql (PR #3274, commit e1daa29) to the
-- vibestack base, verified against main on 2026-11-25.
--
-- Why main's file applies unchanged here: vibestack's trace_runs has the same
-- id, github_user_id, finalized_at and trace_sha256 columns, and its
-- notifications table and outboxes match migration 0079, which this file's
-- rebuild follows. There is no accounts table on either branch, so the
-- ported copy's INTEGER github_id columns and accounts foreign keys were
-- wrong; this file restores main's TEXT github_id columns and drops them.
--
-- Two deliberate deviations from main's file:
-- 1. Both terms_version CHECKs also admit 'private-trace-v3', so a future v3
--    confirmation needs no further migration. Nothing writes v3 yet.
-- 2. This header comment.
--
-- Merge order with sibling PR #3335: merge this PR first. Its migration 0151
-- rebuilds trace_runs and must carry terms_version through its
-- INSERT...SELECT, and drop its duplicate trace_runs_account_finalized
-- index creation, once this migration has landed.
--

-- Trace licensing consent records (design 2026-11-22). Each trace records the
-- terms version it was uploaded under, an account keeps one licensing setting,
-- and every licence and every setting change leaves append-only history.
ALTER TABLE trace_runs ADD COLUMN terms_version TEXT
  CHECK (terms_version IS NULL OR terms_version IN ('private-trace-v1', 'private-trace-v2', 'private-trace-v3'));
-- Runs that already hold a trace were uploaded under version 1. A run still
-- awaiting its trace stays unstamped, so its first intent sets the version.
UPDATE trace_runs SET terms_version = 'private-trace-v1' WHERE trace_sha256 IS NOT NULL;
CREATE INDEX trace_runs_account_finalized ON trace_runs(github_user_id, finalized_at);

CREATE TABLE trace_licensing_settings (
  github_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  provider_terms_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (provider_terms_confirmed IN (0, 1)),
  changed_at TEXT NOT NULL
) STRICT;

CREATE TABLE trace_licensing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('enabled', 'disabled', 'opted_in', 'account_closed')),
  terms_version TEXT NOT NULL CHECK (terms_version IN ('private-trace-v1', 'private-trace-v2', 'private-trace-v3')),
  affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  at TEXT NOT NULL
) STRICT;
CREATE INDEX trace_licensing_events_account ON trace_licensing_events(github_id, id);

CREATE TABLE trace_licences (
  run_id TEXT PRIMARY KEY REFERENCES trace_runs(id),
  github_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('licensed', 'withdrawn')),
  basis TEXT NOT NULL CHECK (basis IN ('upload', 'opt_in')),
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX trace_licences_account ON trace_licences(github_id, state);

CREATE TABLE trace_licence_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES trace_runs(id),
  github_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('granted', 'withdrawn')),
  reason TEXT NOT NULL CHECK (reason IN ('upload', 'opt_in', 'setting_off', 'account_closed')),
  account_event_id INTEGER REFERENCES trace_licensing_events(id),
  at TEXT NOT NULL
) STRICT;
CREATE INDEX trace_licence_events_run ON trace_licence_events(run_id, id);

CREATE TRIGGER trace_licensing_events_no_update BEFORE UPDATE ON trace_licensing_events
BEGIN SELECT RAISE(ABORT, 'trace licensing history is append-only'); END;
CREATE TRIGGER trace_licensing_events_no_delete BEFORE DELETE ON trace_licensing_events
BEGIN SELECT RAISE(ABORT, 'trace licensing history is append-only'); END;
CREATE TRIGGER trace_licence_events_no_update BEFORE UPDATE ON trace_licence_events
BEGIN SELECT RAISE(ABORT, 'trace licence history is append-only'); END;
CREATE TRIGGER trace_licence_events_no_delete BEFORE DELETE ON trace_licence_events
BEGIN SELECT RAISE(ABORT, 'trace licence history is append-only'); END;

-- Notifications: add trace_licensing_available (rebuild as in 0079).
CREATE TABLE notifications_0148_copy (
  event_key TEXT, recipient_github_id TEXT, kind TEXT, subject TEXT,
  detail TEXT, action_path TEXT, source_at TEXT, created_at TEXT, read_at TEXT
) STRICT;
INSERT INTO notifications_0148_copy (
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
    'security_report_received', 'slopbot_appeal_review',
    'slopbot_scam_review', 'trace_licensing_available'
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
FROM notifications_0148_copy;
DROP TABLE notifications_0148_copy;

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

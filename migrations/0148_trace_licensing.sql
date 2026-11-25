-- Trace licensing consent (design 2026-11-22, contract version 2).
-- An account keeps one opt-in setting, and each trace keeps its own
-- licence and append-only licence history. The settings and account
-- event tables share one row per account because the account record
-- is the licence holder; the events are append-only, and the
-- notifications table is rebuilt so the new inbox kind is listed
-- with the kinds that already existed.

ALTER TABLE trace_runs
  ADD COLUMN terms_version TEXT CHECK (terms_version IS NULL OR terms_version IN ('private-trace-v1', 'private-trace-v2'));
UPDATE trace_runs
  SET terms_version = 'private-trace-v1'
  WHERE trace_sha256 IS NOT NULL;
CREATE INDEX trace_runs_account_finalized ON trace_runs(github_user_id, finalized_at);

CREATE TABLE trace_licensing_settings (
  github_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  provider_terms_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (provider_terms_confirmed IN (0, 1)),
  changed_at TEXT NOT NULL,
  FOREIGN KEY (github_id) REFERENCES accounts(github_id)
);

CREATE TABLE trace_licensing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('enabled', 'disabled', 'opted_in', 'account_closed')),
  terms_version TEXT CHECK (terms_version IS NULL OR terms_version IN ('private-trace-v1', 'private-trace-v2')),
  affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  at TEXT NOT NULL,
  FOREIGN KEY (github_id) REFERENCES accounts(github_id)
);

CREATE TABLE trace_licences (
  run_id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('licensed', 'withdrawn')),
  basis TEXT NOT NULL CHECK (basis IN ('upload', 'opt_in')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES trace_runs(id),
  FOREIGN KEY (github_id) REFERENCES accounts(github_id)
);

CREATE TABLE trace_licence_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  github_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('granted', 'withdrawn')),
  reason TEXT NOT NULL CHECK (reason IN ('upload', 'opt_in', 'setting_off', 'account_closed')),
  account_event_id INTEGER,
  at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES trace_runs(id),
  FOREIGN KEY (github_id) REFERENCES accounts(github_id),
  FOREIGN KEY (account_event_id) REFERENCES trace_licensing_events(id)
);

CREATE TRIGGER trace_licensing_events_no_update
  BEFORE UPDATE ON trace_licensing_events
  BEGIN
    SELECT RAISE(ABORT, 'trace_licensing_events is append-only');
  END;

CREATE TRIGGER trace_licensing_events_no_delete
  BEFORE DELETE ON trace_licensing_events
  BEGIN
    SELECT RAISE(ABORT, 'trace_licensing_events is append-only');
  END;

CREATE TRIGGER trace_licence_events_no_update
  BEFORE UPDATE ON trace_licence_events
  BEGIN
    SELECT RAISE(ABORT, 'trace_licence_events is append-only');
  END;

CREATE TRIGGER trace_licence_events_no_delete
  BEFORE DELETE ON trace_licence_events
  BEGIN
    SELECT RAISE(ABORT, 'trace_licence_events is append-only');
  END;

CREATE INDEX trace_licensing_events_account ON trace_licensing_events(github_id, at);
CREATE INDEX trace_licences_account ON trace_licences(github_id, updated_at);
CREATE INDEX trace_licence_events_run ON trace_licence_events(run_id, at);
CREATE INDEX trace_licence_events_account ON trace_licence_events(github_id, at);

-- Rebuild the notifications table so the new kind
-- 'trace_licensing_available' is accepted alongside the existing
-- kinds. The copy keeps every row; the triggers, the index and the
-- event key are recreated unchanged.
CREATE TABLE notifications_0148_copy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  recipient_github_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'application_approved',
    'application_rejected',
    'project_revision',
    'award_reserved',
    'payment_paid',
    'payout_held',
    'wallet_changed',
    'project_quarantined',
    'project_banned',
    'reinstatement_requested',
    'project_reinstated',
    'reinstatement_denied',
    'reinstatement_review',
    'payout_exception',
    'security_case',
    'project_ready',
    'project_scan_failed',
    'project_installation_lost',
    'security_report_received',
    'slopbot_appeal_review',
    'slopbot_scam_review',
    'trace_licensing_available'
  )),
  subject TEXT NOT NULL,
  detail TEXT NOT NULL,
  action_path TEXT,
  source_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY (recipient_github_id) REFERENCES accounts(github_id)
);

INSERT INTO notifications_0148_copy (id, event_key, recipient_github_id, kind, subject, detail, action_path, source_at, created_at, read_at)
  SELECT id, event_key, recipient_github_id, kind, subject, detail, action_path, source_at, created_at, read_at
  FROM notifications;

DROP TRIGGER IF EXISTS notifications_read_once;
DROP TRIGGER IF EXISTS notifications_no_delete;
DROP TRIGGER IF EXISTS security_notification_enqueue;
DROP TRIGGER IF EXISTS activity_notification_enqueue;
DROP TABLE notifications;
ALTER TABLE notifications_0148_copy RENAME TO notifications;

CREATE INDEX notifications_recipient ON notifications(recipient_github_id, source_at DESC);

CREATE TRIGGER notifications_read_once
  BEFORE UPDATE OF read_at ON notifications
  FOR EACH ROW
  WHEN NEW.read_at IS NOT NULL AND OLD.read_at IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'notifications are read once');
  END;

CREATE TRIGGER notifications_no_delete
  BEFORE DELETE ON notifications
  BEGIN
    SELECT RAISE(ABORT, 'notifications are never deleted');
  END;

CREATE TRIGGER security_notification_enqueue
  AFTER INSERT ON security_events
  BEGIN
    INSERT INTO notification_outbox (kind, payload_json)
    VALUES ('security_notification', json_object('security_event_id', NEW.id));
  END;

CREATE TRIGGER activity_notification_enqueue
  AFTER INSERT ON activity_events
  BEGIN
    INSERT INTO notification_outbox (kind, payload_json)
    VALUES ('activity_notification', json_object('activity_event_id', NEW.id));
  END;

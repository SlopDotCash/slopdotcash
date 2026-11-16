-- The slopbot:ready label (operator decision, 16 November 2026; PRD section 5).
-- One row per pull request in a project whose owner turned the label on.
-- `workers/slopbot/ready-label.ts` records the head commit it last checked,
-- whether the label is on (`ready`) or off (`not-ready`, or `off` when the
-- project setting is off), the reason, and when a pending condition that no
-- webhook announces (GitHub's check results) is checked again. Slopbot only
-- adds or removes the label and one comment line; it never merges.
CREATE TABLE slopbot_ready_labels (
 repository_id INTEGER NOT NULL,
 pull_number INTEGER NOT NULL,
 installation_id INTEGER NOT NULL,
 owner TEXT NOT NULL,
 repo TEXT NOT NULL,
 head_sha TEXT,
 state TEXT NOT NULL CHECK (state IN ('ready','not-ready','off')),
 reason TEXT NOT NULL,
 first_seen_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 next_check_at TEXT,
 PRIMARY KEY (repository_id, pull_number)
) STRICT;
CREATE INDEX slopbot_ready_labels_due ON slopbot_ready_labels(next_check_at)
 WHERE next_check_at IS NOT NULL;

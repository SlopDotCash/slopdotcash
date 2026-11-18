-- The refundable submission fee (operator decision, 18 November 2026; PRD
-- section 5, "Submission fee"). One row per pull request the fee applies to.
--
-- Slopbot (`workers/slopbot/submission-fee.ts`) inserts the row when it first
-- asks, with the project's fee at that moment, and later sets `refund_due` or
-- `kept_due` from the pull request's state. The submission-fee Worker sets
-- `paid_*` when it sees an accepted deposit and writes the final `refunded` or
-- `kept`. The Worker sends what is due and never decides it.
CREATE TABLE submission_fee_items (
  repository_id INTEGER NOT NULL,
  pull_number INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  item TEXT NOT NULL,
  stable_minor TEXT NOT NULL,       -- the project's fee when the pull request was first asked
  asked_at TEXT NOT NULL,
  paid_at TEXT,                     -- set by session B's Worker when an accepted deposit is seen
  paid_network TEXT,
  paid_deposit_id INTEGER,
  outcome TEXT,                     -- null | 'refund_due' | 'kept_due' | 'refunded' | 'kept'
  outcome_at TEXT,
  PRIMARY KEY (repository_id, pull_number)
);

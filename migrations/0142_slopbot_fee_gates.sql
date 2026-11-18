-- Slopbot's own record of the submission fee on one pull request (operator
-- decision, 18 November 2026; PRD section 5, "Submission fee"). It holds what
-- Slopbot last wrote to GitHub and when it looks again; what is due and what
-- was paid live in `submission_fee_items`.
--
-- `recorded`: record-only mode noted that the fee would be asked; nothing was
--   written to GitHub and the review ran.
-- `asking`:   one job is posting the comment and label (a short lease, so two
--   jobs never post two comments).
-- `asked`:    the comment and `slopbot:fee-needed` are on the pull request and
--   its review waits.
-- `paid`:     an accepted deposit was seen; the label is `slopbot:fee-paid`
--   and the review ran. `next_check_at` times the refund and kept outcomes.
-- `released`: the fee stopped applying before it was paid (the owner turned
--   the setting off, or the author gained write access); the label is gone
--   and the review ran.
CREATE TABLE slopbot_fee_gates (
 repository_id INTEGER NOT NULL,
 pull_number INTEGER NOT NULL,
 installation_id INTEGER NOT NULL,
 owner TEXT NOT NULL,
 repo TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('recorded','asking','asked','paid','released')),
 reason TEXT NOT NULL,
 comment_id INTEGER,
 updated_at TEXT NOT NULL,
 next_check_at TEXT,
 PRIMARY KEY (repository_id, pull_number)
) STRICT;
CREATE INDEX slopbot_fee_gates_due ON slopbot_fee_gates(next_check_at)
 WHERE next_check_at IS NOT NULL;
CREATE INDEX slopbot_fee_gates_asked ON slopbot_fee_gates(state)
 WHERE state = 'asked';

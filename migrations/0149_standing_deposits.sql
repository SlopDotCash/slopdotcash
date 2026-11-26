-- The standing deposit (operator decision, 23 November 2026; PRD section 5,
-- "Standing deposit", and section 6, FEE-08). A contributor posts one SLOP
-- deposit into the second `SubmissionDeposits` contract on Robinhood Chain;
-- while it stands, Slopbot does not ask them the per pull request fee on a
-- project that accepts standing deposits, once they have a merged pull
-- request there.
--
-- Who writes what:
-- - The website API (`backend/standing-deposit/`) inserts an account's row
--   when the signed-in contributor asks to post one, with the SLOP amount
--   fixed at the rate of that moment, refreshes the amount of an unpaid row,
--   cancels an unpaid row, and records a withdrawal request on a paid row.
-- - The submission-fee Worker sets `paid_*` when it sees an accepted deposit
--   and writes the final `refunded` or `kept` after its transaction.
-- - Slopbot covers pull requests, watches them, and sets `refund_due` or
--   `kept_due` from the rules in `src/lib/standing-deposit.mjs`.
-- The Worker sends what is due and never decides it.
CREATE TABLE standing_deposits (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sd_*' AND length(id) BETWEEN 12 AND 80),
  github_id INTEGER NOT NULL CHECK (github_id > 0),
  round INTEGER NOT NULL CHECK (round >= 1),
  item TEXT NOT NULL UNIQUE CHECK (length(item) = 66 AND item GLOB '0x*'), -- standingDepositItem(github_id, round)
  slop_amount TEXT NOT NULL,            -- base units due, decimal string
  slop_per_usd TEXT NOT NULL,           -- the rate used
  asked_at TEXT NOT NULL,
  cancelled_at TEXT,                    -- an unpaid row the contributor withdrew; a later deposit for it is refused
  paid_at TEXT,                         -- set by the Worker
  paid_network TEXT,                    -- the Worker's ledger key ('robinhood-standing')
  paid_deposit_id INTEGER,
  withdraw_requested_at TEXT,           -- coverage of new pull requests stops here
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('refund_due', 'kept_due', 'refunded', 'kept')),
  outcome_reason TEXT CHECK (outcome_reason IS NULL OR outcome_reason IN ('withdrawn', 'expired', 'strike')),
  outcome_at TEXT,
  strike_repository_id INTEGER,
  strike_pull_number INTEGER,
  UNIQUE (github_id, round),
  CHECK (paid_at IS NULL OR cancelled_at IS NULL),
  CHECK ((paid_at IS NULL) = (paid_deposit_id IS NULL)),
  CHECK (outcome IS NULL OR paid_at IS NOT NULL),
  CHECK ((outcome_reason = 'strike') = (strike_repository_id IS NOT NULL))
) STRICT;

-- One current deposit per account: unpaid and not cancelled, or paid with no
-- final outcome yet.
CREATE UNIQUE INDEX standing_deposits_current
  ON standing_deposits(github_id)
  WHERE cancelled_at IS NULL AND (outcome IS NULL OR outcome IN ('refund_due', 'kept_due'));

-- Pull requests a standing deposit covers. Slopbot writes them at first sight
-- (or when it takes back an unpaid per pull request ask) and watches each one
-- for a strike until it is clear.
CREATE TABLE standing_deposit_covers (
  repository_id INTEGER NOT NULL,
  pull_number INTEGER NOT NULL,
  deposit_id TEXT NOT NULL REFERENCES standing_deposits(id),
  github_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  window_start TEXT NOT NULL,           -- the later of opening and the deposit's payment
  covered_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('watch', 'pending', 'clear', 'strike')),
  pr_open INTEGER NOT NULL CHECK (pr_open IN (0, 1)),
  strike_seen_at TEXT,
  next_check_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_id, pull_number)
) STRICT;
CREATE INDEX standing_deposit_covers_by_deposit ON standing_deposit_covers(deposit_id, state);
CREATE INDEX standing_deposit_covers_due ON standing_deposit_covers(next_check_at) WHERE state IN ('watch', 'pending');

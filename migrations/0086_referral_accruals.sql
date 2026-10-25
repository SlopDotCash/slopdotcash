-- Project referral accruals (workers/referral-accrual; PRD section 11,
-- "Referral program" proposal). A referral accrues only when a finalized
-- payout on a referred project is recorded in payment_obligations. The
-- accrual job reads that ledger and the project's immutable referrer
-- (migration 0055) and appends one row per paid obligation it has judged.
-- Rows are permanent: a later run never recomputes a judged obligation.
-- Amounts are exact base units of the program token as decimal strings;
-- money is never a float. Nothing here reads or writes payments, points,
-- scoring or settlement, and no payout waits on it.

CREATE TABLE referral_accruals (
  obligation_id TEXT PRIMARY KEY REFERENCES payment_obligations(id),
  -- Accrual epoch: the UTC calendar month in which the paid event was observed.
  period TEXT NOT NULL CHECK (length(period) = 7 AND period GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 8 AND 80),
  project_id TEXT NOT NULL,
  referrer_github_id TEXT NOT NULL CHECK (referrer_github_id GLOB '[1-9]*' AND referrer_github_id NOT GLOB '*[^0-9]*'),
  referrer_github_login TEXT NOT NULL CHECK (length(referrer_github_login) BETWEEN 1 AND 39),
  network TEXT NOT NULL,
  paid_transaction TEXT NOT NULL,
  paid_observed_at TEXT NOT NULL,
  -- Gross payout in the obligation's asset base units (6-decimal stablecoin).
  gross_base TEXT NOT NULL CHECK (gross_base GLOB '[1-9]*' AND gross_base NOT GLOB '*[^0-9]*' AND length(gross_base) <= 39),
  asset_address TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  -- Program token base units per one asset micro-unit, as applied to this row.
  rate_base_per_micro TEXT NOT NULL CHECK (rate_base_per_micro GLOB '[0-9]*' AND rate_base_per_micro NOT GLOB '*[^0-9]*'),
  -- rate x gross before any cap.
  computed_base TEXT NOT NULL CHECK (computed_base GLOB '[0-9]*' AND computed_base NOT GLOB '*[^0-9]*' AND length(computed_base) <= 78),
  -- What this row adds to the referrer's cumulative total after caps.
  accrued_base TEXT NOT NULL CHECK (accrued_base GLOB '[0-9]*' AND accrued_base NOT GLOB '*[^0-9]*' AND length(accrued_base) <= 78),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('accrued', 'project_cap', 'pool_cap', 'window_closed', 'held', 'referrer_excluded', 'asset_not_eligible')
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  rule_version TEXT NOT NULL CHECK (rule_version = 'referral-accrual-v1'),
  created_at TEXT NOT NULL,
  CHECK (outcome = 'accrued' OR outcome = 'project_cap' OR outcome = 'pool_cap' OR accrued_base = '0'),
  CHECK (outcome <> 'accrued' OR accrued_base = computed_base)
) STRICT;
CREATE INDEX referral_accruals_period ON referral_accruals(period, paid_observed_at, obligation_id);
CREATE INDEX referral_accruals_referrer ON referral_accruals(referrer_github_id, period);
CREATE INDEX referral_accruals_project ON referral_accruals(project_id, paid_observed_at);

CREATE TRIGGER referral_accruals_no_update BEFORE UPDATE ON referral_accruals
BEGIN SELECT RAISE(ABORT, 'referral accrual immutable'); END;
CREATE TRIGGER referral_accruals_no_delete BEFORE DELETE ON referral_accruals
BEGIN SELECT RAISE(ABORT, 'referral accrual permanent'); END;

-- One public accrual file per closed epoch: the exact bytes the job published,
-- so anyone can recompute it from the public payment record. The file carries
-- every accrual of the epoch, the cumulative total per referrer, the
-- destination wallet it had at epoch close, and the Merkle root over the
-- leaves (address, cumulative) for referrers with a wallet.
CREATE TABLE referral_accrual_files (
  period TEXT PRIMARY KEY CHECK (length(period) = 7 AND period GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  -- Epoch index as the distributor counts it: 0 for the first filed period.
  epoch INTEGER NOT NULL UNIQUE CHECK (epoch >= 0),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 8 AND 80),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  body TEXT NOT NULL CHECK (json_valid(body) AND length(body) <= 4194304),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- 0x-prefixed 32-byte hex, or NULL when no referrer had a wallet.
  merkle_root TEXT CHECK (merkle_root IS NULL OR (length(merkle_root) = 66 AND merkle_root GLOB '0x*' AND substr(merkle_root, 3) NOT GLOB '*[^0-9a-f]*')),
  -- Sum of every cumulative total in the tree, in token base units.
  tree_total_base TEXT NOT NULL CHECK (tree_total_base GLOB '[0-9]*' AND tree_total_base NOT GLOB '*[^0-9]*' AND length(tree_total_base) <= 78),
  leaf_count INTEGER NOT NULL CHECK (leaf_count >= 0),
  created_at TEXT NOT NULL,
  CHECK ((merkle_root IS NULL) = (leaf_count = 0))
) STRICT;
CREATE TRIGGER referral_accrual_files_no_update BEFORE UPDATE ON referral_accrual_files
BEGIN SELECT RAISE(ABORT, 'referral accrual file immutable'); END;
CREATE TRIGGER referral_accrual_files_no_delete BEFORE DELETE ON referral_accrual_files
BEGIN SELECT RAISE(ABORT, 'referral accrual file permanent'); END;
-- Epochs file in order: a period can only follow the previous filed period.
CREATE TRIGGER referral_accrual_files_in_order BEFORE INSERT ON referral_accrual_files
WHEN NEW.epoch <> (SELECT COUNT(*) FROM referral_accrual_files)
  OR EXISTS (SELECT 1 FROM referral_accrual_files WHERE period >= NEW.period)
BEGIN SELECT RAISE(ABORT, 'referral accrual files must be filed in epoch order'); END;

-- A hold excludes a project from future accruals with a public reason, in the
-- shape of a held cycle row. It is written by the operator outside the job
-- (there is no route for it) and never lifted in place: a later row with
-- `lifted_at` set ends it. Accruals already filed are unchanged.
CREATE TABLE referral_holds (
  id TEXT PRIMARY KEY CHECK (id GLOB 'rhold_*' AND length(id) BETWEEN 12 AND 80),
  project_id TEXT NOT NULL REFERENCES projects(id),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  actor_github_id TEXT NOT NULL CHECK (actor_github_id GLOB '[1-9]*' AND actor_github_id NOT GLOB '*[^0-9]*'),
  actor_github_login TEXT NOT NULL CHECK (length(actor_github_login) BETWEEN 1 AND 39),
  created_at TEXT NOT NULL,
  lifted_at TEXT,
  lift_reason TEXT CHECK (lift_reason IS NULL OR length(lift_reason) BETWEEN 1 AND 1000),
  CHECK ((lifted_at IS NULL) = (lift_reason IS NULL))
) STRICT;
CREATE INDEX referral_holds_project ON referral_holds(project_id, created_at);
-- Only the lift may change a hold, exactly once.
CREATE TRIGGER referral_holds_lift_only BEFORE UPDATE ON referral_holds
WHEN NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.reason <> OLD.reason
  OR NEW.actor_github_id <> OLD.actor_github_id OR NEW.actor_github_login <> OLD.actor_github_login
  OR NEW.created_at <> OLD.created_at OR OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL
BEGIN SELECT RAISE(ABORT, 'referral hold may only be lifted once'); END;
CREATE TRIGGER referral_holds_no_delete BEFORE DELETE ON referral_holds
BEGIN SELECT RAISE(ABORT, 'referral hold permanent'); END;

-- One accrual run at a time, so two runs never file the same epoch.
CREATE TABLE referral_accrual_locks (
  scope TEXT PRIMARY KEY CHECK (scope = 'accrual'),
  run_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

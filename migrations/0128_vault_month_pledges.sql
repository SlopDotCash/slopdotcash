-- On-chain month pledges (operator decision, 15 November 2026, PRD section 6).
-- An owner can lock a month's pool in an upgraded vault: the contract then
-- refuses withdrawals that would take the locked amount and lets Slop's
-- executor reserve that month even when automatic monthly payment is off.
--
-- The payments Worker reads, with each finalized vault refresh, the vault's
-- open pledged total and its pledge for each month from the previous one to
-- eleven months ahead (`backend/payments/month-pledges.ts`).
-- `vault_snapshots.open_pledged_gross` is NULL for a vault whose contract has
-- no pledge support; such a vault keeps the funded-on-the-1st rule.
-- `vault_month_pledges` keeps one row per vault and month: the latest read.
-- A row stays after its pledge closes, so a month that was pledged keeps its
-- consent to reserve while the executor finishes it.
ALTER TABLE vault_snapshots ADD COLUMN open_pledged_gross TEXT CHECK (open_pledged_gross IS NULL OR (length(open_pledged_gross) BETWEEN 1 AND 39 AND open_pledged_gross NOT GLOB '*[^0-9]*'));

CREATE TABLE vault_month_pledges (
  project_id TEXT NOT NULL,
  network TEXT NOT NULL,
  vault TEXT NOT NULL,
  period TEXT NOT NULL CHECK (length(period) = 7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  amount TEXT NOT NULL CHECK (length(amount) BETWEEN 1 AND 39 AND amount NOT GLOB '*[^0-9]*'),
  open INTEGER NOT NULL CHECK (open IN (0, 1)),
  block_number TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, network, vault, period)
) STRICT;

CREATE INDEX vault_month_pledges_period ON vault_month_pledges(project_id, period);

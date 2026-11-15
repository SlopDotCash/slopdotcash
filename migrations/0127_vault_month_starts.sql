-- A month is promised only if it was funded on the 1st (operator decision,
-- 15 November 2026, PRD section 6). The payments Worker refreshes each
-- vault's finalized counters in `vault_snapshots` every few minutes; this
-- table keeps the first finalized read of each UTC month for each vault,
-- dated by its block. Pages compare it with the month's amount and with the
-- current counters, so a withdrawal during the month is visible.
--
-- `storeVaultSnapshot` (backend/payments/vault-snapshots.ts) writes the row
-- after a stored refresh; rows never change.
CREATE TABLE vault_month_starts (
  project_id TEXT NOT NULL,
  network TEXT NOT NULL,
  vault TEXT NOT NULL,
  period TEXT NOT NULL CHECK (length(period) = 7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  free_balance TEXT NOT NULL CHECK (length(free_balance) BETWEEN 1 AND 39 AND free_balance NOT GLOB '*[^0-9]*'),
  total_gross_withdrawn TEXT NOT NULL CHECK (length(total_gross_withdrawn) BETWEEN 1 AND 39 AND total_gross_withdrawn NOT GLOB '*[^0-9]*'),
  block_number TEXT NOT NULL,
  block_time TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, network, vault, period)
) STRICT;

CREATE TRIGGER vault_month_starts_no_update BEFORE UPDATE ON vault_month_starts
BEGIN SELECT RAISE(ABORT, 'vault month start immutable'); END;
CREATE TRIGGER vault_month_starts_no_delete BEFORE DELETE ON vault_month_starts
BEGIN SELECT RAISE(ABORT, 'vault month start permanent'); END;

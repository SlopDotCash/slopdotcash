-- Any wallet may deposit into a project vault (operator decision,
-- 18 November 2026, PRD section 6). The vault contract names the depositor
-- only in its `Deposited` event, so the payments Worker records each
-- finalized event of every registered ordinary vault here, and the project
-- page lists them under "Funded by". Private bounty vaults are not recorded.
--
-- The list is display evidence only. Balances, funded months, listing and
-- payment still come from the finalized vault counters in `vault_snapshots`.
-- A row never changes: `workers/payments/deposits.ts` inserts each event once,
-- keyed by its network, transaction and event index (the EVM log index, or
-- the position of the Solana instruction in execution order).
CREATE TABLE vault_deposits (
  project_id TEXT NOT NULL,
  network TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain IN ('base', 'robinhood', 'ethereum', 'solana')),
  vault TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  event_index INTEGER NOT NULL CHECK (event_index >= 0),
  depositor TEXT NOT NULL CHECK (length(depositor) BETWEEN 32 AND 44),
  amount TEXT NOT NULL CHECK (length(amount) BETWEEN 1 AND 39 AND amount NOT GLOB '*[^0-9]*' AND amount NOT GLOB '0*'),
  block_number TEXT NOT NULL CHECK (length(block_number) BETWEEN 1 AND 20 AND block_number NOT GLOB '*[^0-9]*'),
  block_time TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (network, transaction_id, event_index)
) STRICT;

CREATE INDEX vault_deposits_by_project ON vault_deposits(project_id, block_time DESC);

CREATE TRIGGER vault_deposits_no_update BEFORE UPDATE ON vault_deposits
BEGIN SELECT RAISE(ABORT, 'vault deposit immutable'); END;
CREATE TRIGGER vault_deposits_no_delete BEFORE DELETE ON vault_deposits
BEGIN SELECT RAISE(ABORT, 'vault deposit permanent'); END;

-- How far each vault's deposit history has been read. This cursor is
-- separate from `payment_chain_cursors`: the payment scanner started at its
-- own cursor and never read deposits, so this scan starts at the vault's
-- creation and catches up on its own.
--
-- EVM: `position` is the last finalized block read. Solana: `position` is
-- the newest signature at or below which every transaction has been read;
-- `pending_top` is the newest signature of the interval being read and
-- `resume_before` the oldest signature already read in it.
CREATE TABLE vault_deposit_cursors (
  project_id TEXT NOT NULL,
  network TEXT NOT NULL,
  vault TEXT NOT NULL,
  position TEXT,
  pending_top TEXT,
  resume_before TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (project_id, network, vault),
  CHECK (resume_before IS NULL OR pending_top IS NOT NULL)
) STRICT;

-- The refundable submission fee on Solana (operator decision, 25 November
-- 2026; PRD section 6, "Submission fee deposits", "Solana"). Deposits of the
-- `slop-submission-deposits` program are recorded in the existing
-- `submission_fee_deposits` table under network 'solana-mainnet':
-- `deposit_id` is the id the program stored in the record, `token` the mint,
-- `payer` and `kept_to` the wallets, `tx_hash` the signature of the
-- transaction that created the record and `block_number` its slot. The row
-- of that network in `submission_fee_cursors` holds the next deposit id to
-- record, not a block.
--
-- A Solana deposit's record is an account whose address does not follow from
-- its id (its seeds are the payer and a number the payer picked). The Worker
-- needs that address to resolve the deposit and to read how it was settled,
-- so it is kept beside the row. Null on the EVM networks.
ALTER TABLE submission_fee_deposits ADD COLUMN deposit_account TEXT
  CHECK (deposit_account IS NULL OR length(deposit_account) BETWEEN 32 AND 44);

-- The resolver's Solana sends. `submission_fee_sends` admits only 0x
-- addresses and hashes, and its rows are permanent, so the Solana sends have
-- this table of their own with the same life cycle. One transaction carries
-- several `resolve` instructions. `deposits` is a JSON array of
-- {"id": deposit id, "refund": true | false}. `tx_id` is the transaction's
-- signature and `raw_tx` its signed bytes in base64, recorded before the
-- broadcast so an uncertain send is resent unchanged and never signed again.
-- A Solana transaction can land only up to `last_valid_block_height`; once
-- the finalized chain is past it without the signature, the send has failed
-- and its deposits are sent again in a new transaction.
CREATE TABLE submission_fee_solana_sends (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sfs_*' AND length(id) BETWEEN 12 AND 80),
  network TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  program TEXT NOT NULL CHECK (length(program) BETWEEN 32 AND 44),
  deposits TEXT NOT NULL CHECK (json_valid(deposits) AND json_type(deposits) = 'array' AND json_array_length(deposits) BETWEEN 1 AND 100),
  resolver TEXT CHECK (resolver IS NULL OR length(resolver) BETWEEN 32 AND 44),
  tx_id TEXT CHECK (tx_id IS NULL OR length(tx_id) BETWEEN 64 AND 88),
  -- The signed transaction is public once broadcast. Kept only for rebroadcast.
  raw_tx TEXT CHECK (raw_tx IS NULL OR length(raw_tx) BETWEEN 10 AND 2048),
  last_valid_block_height INTEGER CHECK (last_valid_block_height IS NULL OR last_valid_block_height >= 0),
  -- The network fee the signed transaction pays, in lamports.
  maximum_lamports TEXT CHECK (maximum_lamports IS NULL OR (maximum_lamports GLOB '[1-9]*' AND maximum_lamports NOT GLOB '*[^0-9]*' AND length(maximum_lamports) <= 18)),
  state TEXT NOT NULL CHECK (state IN ('recorded', 'submitted', 'unknown', 'finalized', 'failed')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200),
  slot INTEGER CHECK (slot IS NULL OR slot >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finalized_at TEXT,
  -- A dry run holds no signature; a live send always holds its signed bytes.
  CHECK ((mode = 'dry_run') = (state = 'recorded')),
  CHECK ((mode = 'live') = (resolver IS NOT NULL AND tx_id IS NOT NULL AND raw_tx IS NOT NULL AND last_valid_block_height IS NOT NULL AND maximum_lamports IS NOT NULL)),
  CHECK ((state = 'finalized') = (finalized_at IS NOT NULL AND slot IS NOT NULL)),
  CHECK (state <> 'failed' OR reason IS NOT NULL)
) STRICT;

-- One send in flight per network; the next waits until it is finalized or failed.
CREATE UNIQUE INDEX submission_fee_solana_sends_one_open
  ON submission_fee_solana_sends(network) WHERE state IN ('submitted', 'unknown');
CREATE UNIQUE INDEX submission_fee_solana_sends_tx
  ON submission_fee_solana_sends(network, tx_id) WHERE tx_id IS NOT NULL;
CREATE INDEX submission_fee_solana_sends_by_network
  ON submission_fee_solana_sends(network, created_at);

-- Identity and signed bytes never change; finalized and failed are final.
CREATE TRIGGER submission_fee_solana_sends_identity BEFORE UPDATE ON submission_fee_solana_sends
WHEN NEW.id <> OLD.id OR NEW.network <> OLD.network OR NEW.mode <> OLD.mode
  OR NEW.program <> OLD.program OR NEW.deposits <> OLD.deposits
  OR NEW.resolver IS NOT OLD.resolver OR NEW.tx_id IS NOT OLD.tx_id
  OR NEW.raw_tx IS NOT OLD.raw_tx
  OR NEW.last_valid_block_height IS NOT OLD.last_valid_block_height
  OR NEW.maximum_lamports IS NOT OLD.maximum_lamports
  OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'submission fee send identity is immutable'); END;
CREATE TRIGGER submission_fee_solana_sends_terminal BEFORE UPDATE ON submission_fee_solana_sends
WHEN OLD.state IN ('recorded', 'finalized', 'failed')
BEGIN SELECT RAISE(ABORT, 'submission fee send state is final'); END;
CREATE TRIGGER submission_fee_solana_sends_no_delete BEFORE DELETE ON submission_fee_solana_sends
BEGIN SELECT RAISE(ABORT, 'submission fee sends are permanent'); END;

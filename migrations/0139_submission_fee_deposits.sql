-- The refundable submission fee (operator decision, 18 November 2026; PRD
-- section 6, "Submission fee deposits"). An outside contributor deposits a
-- small fee into the SubmissionDeposits contract on Base or Robinhood Chain
-- before Slopbot reviews their pull request. `workers/submission-fee` reads
-- the contract's events and keeps this record of every deposit.
--
-- A row is written when its `Deposited` event has the network's confirmation
-- count on top of it, with `finalized_at` null, and is confirmed or replaced
-- when the block is finalized. `accepted` is the Worker's judgement of
-- whether the deposit pays for its pull request (`src/lib/submission-fee.mjs`).
-- `state` follows the pull request's row in `submission_fee_items`
-- (`refund_due`, `kept_due`) and then the contract's own finalized `Resolved`
-- and `Reclaimed` events (`refunded`, `kept`, `reclaimed`).
CREATE TABLE submission_fee_deposits (
  network TEXT NOT NULL,            -- 'base-mainnet' | 'robinhood-mainnet'
  deposit_id INTEGER NOT NULL,
  item TEXT NOT NULL,               -- 0x + 64 hex
  repository_id INTEGER,            -- null until matched to a known pull request
  pull_number INTEGER,
  payer TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,             -- base units, decimal string
  kept_to TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_time TEXT NOT NULL,
  finalized_at TEXT,
  accepted INTEGER,                 -- null = not judged yet, 1, 0
  reject_reason TEXT,
  state TEXT NOT NULL,              -- 'open' | 'refund_due' | 'kept_due' | 'refunded' | 'kept' | 'reclaimed'
  resolve_tx TEXT,
  resolved_at TEXT,
  PRIMARY KEY (network, deposit_id)
);
CREATE TABLE submission_fee_cursors (network TEXT PRIMARY KEY, next_block INTEGER NOT NULL);

CREATE INDEX submission_fee_deposits_by_item ON submission_fee_deposits(item);
CREATE INDEX submission_fee_deposits_by_state ON submission_fee_deposits(network, state);

-- The resolver's sends. The Worker signs one `resolveMany` transaction for a
-- network's due deposits and records the signed bytes here before it
-- broadcasts them, so an uncertain send is resent unchanged and never signed
-- again. In `dry_run` it records the list it would send, with no signature.
-- `deposits` is a JSON array of {"id": deposit id, "refund": true | false}.
-- Rows are permanent; only the state moves forward.
CREATE TABLE submission_fee_sends (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sfs_*' AND length(id) BETWEEN 12 AND 80),
  network TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  contract TEXT NOT NULL CHECK (length(contract) = 42 AND contract GLOB '0x*'),
  deposits TEXT NOT NULL CHECK (json_valid(deposits) AND json_type(deposits) = 'array' AND json_array_length(deposits) BETWEEN 1 AND 100),
  resolver TEXT CHECK (resolver IS NULL OR (length(resolver) = 42 AND resolver GLOB '0x*')),
  tx_id TEXT CHECK (tx_id IS NULL OR (length(tx_id) = 66 AND tx_id GLOB '0x*')),
  -- The signed transaction is public once broadcast. Kept only for rebroadcast.
  raw_tx TEXT CHECK (raw_tx IS NULL OR length(raw_tx) BETWEEN 10 AND 32768),
  evm_nonce INTEGER CHECK (evm_nonce IS NULL OR evm_nonce >= 0),
  -- The most native currency the signed transaction can spend, in wei.
  maximum_native_wei TEXT CHECK (maximum_native_wei IS NULL OR (maximum_native_wei GLOB '[1-9]*' AND maximum_native_wei NOT GLOB '*[^0-9]*' AND length(maximum_native_wei) <= 30)),
  state TEXT NOT NULL CHECK (state IN ('recorded', 'submitted', 'unknown', 'finalized', 'failed')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200),
  block_number INTEGER CHECK (block_number IS NULL OR block_number >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finalized_at TEXT,
  -- A dry run holds no signature; a live send always holds its signed bytes.
  CHECK ((mode = 'dry_run') = (state = 'recorded')),
  CHECK ((mode = 'live') = (resolver IS NOT NULL AND tx_id IS NOT NULL AND raw_tx IS NOT NULL AND evm_nonce IS NOT NULL AND maximum_native_wei IS NOT NULL)),
  CHECK ((state = 'finalized') = (finalized_at IS NOT NULL AND block_number IS NOT NULL)),
  CHECK (state <> 'failed' OR reason IS NOT NULL)
) STRICT;

-- One send in flight per network; the next waits until it is finalized or failed.
CREATE UNIQUE INDEX submission_fee_sends_one_open
  ON submission_fee_sends(network) WHERE state IN ('submitted', 'unknown');
CREATE UNIQUE INDEX submission_fee_sends_tx ON submission_fee_sends(network, tx_id) WHERE tx_id IS NOT NULL;
CREATE INDEX submission_fee_sends_by_network ON submission_fee_sends(network, created_at);

-- Identity and signed bytes never change; finalized and failed are final.
CREATE TRIGGER submission_fee_sends_identity BEFORE UPDATE ON submission_fee_sends
WHEN NEW.id <> OLD.id OR NEW.network <> OLD.network OR NEW.mode <> OLD.mode
  OR NEW.contract <> OLD.contract OR NEW.deposits <> OLD.deposits
  OR NEW.resolver IS NOT OLD.resolver OR NEW.tx_id IS NOT OLD.tx_id
  OR NEW.raw_tx IS NOT OLD.raw_tx OR NEW.evm_nonce IS NOT OLD.evm_nonce
  OR NEW.maximum_native_wei IS NOT OLD.maximum_native_wei
  OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'submission fee send identity is immutable'); END;
CREATE TRIGGER submission_fee_sends_terminal BEFORE UPDATE ON submission_fee_sends
WHEN OLD.state IN ('recorded', 'finalized', 'failed')
BEGIN SELECT RAISE(ABORT, 'submission fee send state is final'); END;
CREATE TRIGGER submission_fee_sends_no_delete BEFORE DELETE ON submission_fee_sends
BEGIN SELECT RAISE(ABORT, 'submission fee sends are permanent'); END;

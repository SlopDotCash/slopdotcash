-- Claims share the existing signed-send journal and pending-token guard.
-- Existing records keep their conversion kind. EVM claims have no expiry;
-- Solana claims retain their blockhash expiry.
-- Rebuild only to make the expiry/minimum constraint depend on the kind.

CREATE TABLE fee_conversions_next (
  kind TEXT NOT NULL DEFAULT 'conversion' CHECK (kind IN ('conversion', 'claim')),
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 8 AND 80),
  network TEXT NOT NULL CHECK (network IN ('base', 'ethereum', 'robinhood', 'solana')),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  fee_wallet TEXT NOT NULL CHECK (length(fee_wallet) BETWEEN 32 AND 64),
  token TEXT NOT NULL CHECK (length(token) BETWEEN 32 AND 64),
  target_token TEXT NOT NULL CHECK (length(target_token) BETWEEN 32 AND 64),
  -- Exact integer base units as decimal strings; money is never a float.
  amount_in TEXT NOT NULL CHECK (amount_in GLOB '[0-9]*' AND amount_in NOT GLOB '*[^0-9]*'),
  route TEXT CHECK (route IS NULL OR route IN ('kyberswap', 'jupiter')),
  quote_amount_out TEXT CHECK (
    quote_amount_out IS NULL OR
    (quote_amount_out GLOB '[0-9]*' AND quote_amount_out NOT GLOB '*[^0-9]*')
  ),
  min_amount_out TEXT CHECK (
    min_amount_out IS NULL OR
    (min_amount_out GLOB '[0-9]*' AND min_amount_out NOT GLOB '*[^0-9]*')
  ),
  -- Stablecoin micro-units of the quoted output, used for the value caps.
  quote_value_micro INTEGER CHECK (quote_value_micro IS NULL OR quote_value_micro >= 0),
  price_impact_bps INTEGER,
  -- Bounded summary of the aggregator quote; never a key or a signature.
  quote TEXT CHECK (quote IS NULL OR (json_valid(quote) AND length(quote) <= 8192)),
  approval_tx_id TEXT,
  tx_id TEXT,
  -- The signed transaction is public once broadcast. It is kept only so an
  -- unknown send can be rebroadcast unchanged instead of signed again.
  raw_tx TEXT CHECK (raw_tx IS NULL OR length(raw_tx) <= 262146),
  evm_nonce INTEGER CHECK (evm_nonce IS NULL OR evm_nonce >= 0),
  -- EVM: unix seconds of the router deadline. Solana: last valid block height.
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > 0),
  amount_out TEXT CHECK (
    amount_out IS NULL OR (amount_out GLOB '[0-9]*' AND amount_out NOT GLOB '*[^0-9]*')
  ),
  -- Fee-wallet balances in base units (PRD TOK-07 proceeds record): the input
  -- token and stablecoin when quoted, and the stablecoin when finalized.
  token_balance_before TEXT CHECK (
    token_balance_before IS NULL OR
    (token_balance_before GLOB '[0-9]*' AND token_balance_before NOT GLOB '*[^0-9]*')
  ),
  target_balance_before TEXT CHECK (
    target_balance_before IS NULL OR
    (target_balance_before GLOB '[0-9]*' AND target_balance_before NOT GLOB '*[^0-9]*')
  ),
  target_balance_after TEXT CHECK (
    target_balance_after IS NULL OR
    (target_balance_after GLOB '[0-9]*' AND target_balance_after NOT GLOB '*[^0-9]*')
  ),
  state TEXT NOT NULL CHECK (
    state IN ('quoted', 'pending', 'skipped', 'no_route', 'submitted', 'finalized', 'failed', 'unknown')
  ),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  finalized_at TEXT,
  CHECK (mode = 'live' OR state IN ('quoted', 'pending', 'skipped', 'no_route', 'failed')),
  CHECK (
    state NOT IN ('submitted', 'unknown', 'finalized') OR
    (tx_id IS NOT NULL AND raw_tx IS NOT NULL AND submitted_at IS NOT NULL AND
      (kind = 'claim' OR (expires_at IS NOT NULL AND min_amount_out IS NOT NULL)))
  ),
  CHECK ((state = 'finalized') = (finalized_at IS NOT NULL AND amount_out IS NOT NULL)),
  CHECK (state NOT IN ('pending', 'skipped', 'no_route', 'failed') OR reason IS NOT NULL),
  CHECK (network <> 'solana' OR evm_nonce IS NULL)
) STRICT;

INSERT INTO fee_conversions_next (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, route, quote_amount_out, min_amount_out, quote_value_micro, price_impact_bps, quote, approval_tx_id, tx_id, raw_tx, evm_nonce, expires_at, amount_out, token_balance_before, target_balance_before, target_balance_after, state, reason, created_at, updated_at, submitted_at, finalized_at)
  SELECT id, run_id, network, mode, fee_wallet, token, target_token, amount_in, route, quote_amount_out, min_amount_out, quote_value_micro, price_impact_bps, quote, approval_tx_id, tx_id, raw_tx, evm_nonce, expires_at, amount_out, token_balance_before, target_balance_before, target_balance_after, state, reason, created_at, updated_at, submitted_at, finalized_at FROM fee_conversions;
DROP TABLE fee_conversions;
ALTER TABLE fee_conversions_next RENAME TO fee_conversions;

-- At most one unresolved send per wallet token. A retry must reconcile it first.
CREATE UNIQUE INDEX fee_conversions_one_open
  ON fee_conversions(network, token) WHERE state IN ('submitted', 'unknown');
CREATE UNIQUE INDEX fee_conversions_tx
  ON fee_conversions(network, tx_id) WHERE tx_id IS NOT NULL;
CREATE INDEX fee_conversions_recent ON fee_conversions(created_at);
CREATE INDEX fee_conversions_token ON fee_conversions(network, token, created_at);

-- A settled attempt keeps its identity and outcome.
CREATE TRIGGER fee_conversions_terminal
BEFORE UPDATE ON fee_conversions
WHEN OLD.state IN ('pending', 'skipped', 'no_route', 'finalized', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'fee conversion record is final');
END;

CREATE TRIGGER fee_conversions_identity
BEFORE UPDATE ON fee_conversions
WHEN NEW.kind <> OLD.kind OR NEW.id <> OLD.id OR NEW.network <> OLD.network OR NEW.mode <> OLD.mode OR
  NEW.token <> OLD.token OR NEW.fee_wallet <> OLD.fee_wallet OR
  NEW.amount_in <> OLD.amount_in OR NEW.created_at <> OLD.created_at OR
  (OLD.tx_id IS NOT NULL AND NEW.tx_id IS NOT OLD.tx_id) OR
  (OLD.raw_tx IS NOT NULL AND NEW.raw_tx IS NOT OLD.raw_tx) OR
  (OLD.kind = 'claim' AND (NEW.quote IS NOT OLD.quote OR
    NEW.target_token IS NOT OLD.target_token OR NEW.evm_nonce IS NOT OLD.evm_nonce))
BEGIN
  SELECT RAISE(ABORT, 'fee conversion identity is immutable');
END;

CREATE TRIGGER fee_conversions_no_delete
BEFORE DELETE ON fee_conversions
BEGIN
  SELECT RAISE(ABORT, 'fee conversion records are permanent');
END;

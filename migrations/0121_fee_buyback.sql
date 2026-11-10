-- SLOP buyback (PRD section 6, owner decision of 10 November 2026). The
-- existing fee journal gains three send kinds, so bridge orders, SLOP
-- purchases and burns share its lease, nonce floor, pending-token guard,
-- native-gas commit and replacement history:
--   bridge   USDC on Base, Ethereum or Solana into one deBridge DLN order
--            that delivers USDG to the Robinhood Chain fee wallet.
--   buyback  a swap on Robinhood Chain whose output is SLOP.
--   burn     a SLOP transfer from the fee wallet to the burn address.
-- Every older row is retained unchanged. This migration activates nothing.

-- The replacement trigger reads fee_conversions; recreate it after the rebuild.
DROP TRIGGER fee_replacement_commit_gas;

CREATE TABLE fee_conversions_next (
  kind TEXT NOT NULL DEFAULT 'conversion' CHECK (
    kind IN ('conversion', 'claim', 'approval', 'bridge', 'buyback', 'burn')
  ),
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 8 AND 80),
  network TEXT NOT NULL CHECK (network IN ('base', 'ethereum', 'robinhood', 'solana')),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  fee_wallet TEXT NOT NULL CHECK (length(fee_wallet) BETWEEN 32 AND 64),
  token TEXT NOT NULL CHECK (length(token) BETWEEN 32 AND 64),
  target_token TEXT NOT NULL CHECK (length(target_token) BETWEEN 32 AND 64),
  -- Exact integer base units as decimal strings; money is never a float.
  amount_in TEXT NOT NULL CHECK (amount_in GLOB '[0-9]*' AND amount_in NOT GLOB '*[^0-9]*'),
  route TEXT CHECK (route IS NULL OR route IN ('kyberswap', 'jupiter', 'debridge')),
  quote_amount_out TEXT CHECK (
    quote_amount_out IS NULL OR
    (quote_amount_out GLOB '[0-9]*' AND quote_amount_out NOT GLOB '*[^0-9]*')
  ),
  min_amount_out TEXT CHECK (
    min_amount_out IS NULL OR
    (min_amount_out GLOB '[0-9]*' AND min_amount_out NOT GLOB '*[^0-9]*')
  ),
  -- Stablecoin micro-units of the send's value, used for the value caps.
  quote_value_micro INTEGER CHECK (quote_value_micro IS NULL OR quote_value_micro >= 0),
  price_impact_bps INTEGER,
  -- Bounded summary of the quote; never a key or a signature. A bridge row
  -- holds its order id and exact order terms here.
  quote TEXT CHECK (quote IS NULL OR (json_valid(quote) AND length(quote) <= 8192)),
  approval_tx_id TEXT,
  landed_tx_id TEXT CHECK (landed_tx_id IS NULL OR length(landed_tx_id) BETWEEN 32 AND 128),
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
  native_gas_id TEXT,
  CHECK (mode = 'live' OR state IN ('quoted', 'pending', 'skipped', 'no_route', 'failed')),
  -- A swap needs its deadline and signed minimum. A bridge order has no EVM
  -- deadline but always its minimum arrival. A claim, approval or burn has neither.
  CHECK (
    state NOT IN ('submitted', 'unknown', 'finalized') OR
    (tx_id IS NOT NULL AND raw_tx IS NOT NULL AND submitted_at IS NOT NULL AND
      (kind IN ('claim', 'approval', 'burn') OR
        (min_amount_out IS NOT NULL AND (kind = 'bridge' OR expires_at IS NOT NULL))))
  ),
  CHECK ((state = 'finalized') = (finalized_at IS NOT NULL AND amount_out IS NOT NULL)),
  CHECK (state NOT IN ('pending', 'skipped', 'no_route', 'failed') OR reason IS NOT NULL),
  CHECK (network <> 'solana' OR (evm_nonce IS NULL AND kind <> 'approval')),
  -- An approval names its one spender through its route: the pinned swap
  -- router (kyberswap) or the pinned bridge contract (debridge).
  CHECK (kind <> 'approval' OR (approval_tx_id = tx_id AND route IN ('kyberswap', 'debridge'))),
  CHECK (kind <> 'approval' OR amount_out IS NULL OR amount_out = '0'),
  -- SLOP is bought and burned only on Robinhood Chain; a bridge only leaves another network.
  CHECK (kind NOT IN ('buyback', 'burn') OR network = 'robinhood'),
  CHECK (kind <> 'bridge' OR (network <> 'robinhood' AND route = 'debridge')),
  -- A burn sends exactly its recorded amount and nothing else.
  CHECK (kind <> 'burn' OR (token = target_token AND route IS NULL AND
    (amount_out IS NULL OR amount_out = amount_in))),
  -- A signed bridge or burn always records the terms it was signed for.
  CHECK (kind NOT IN ('bridge', 'burn') OR state NOT IN ('submitted', 'unknown', 'finalized') OR quote IS NOT NULL)
) STRICT;

INSERT INTO fee_conversions_next (kind, landed_tx_id, id, run_id, network, mode, fee_wallet, token, target_token, amount_in, route, quote_amount_out, min_amount_out, quote_value_micro, price_impact_bps, quote, approval_tx_id, tx_id, raw_tx, evm_nonce, expires_at, amount_out, token_balance_before, target_balance_before, target_balance_after, state, reason, created_at, updated_at, submitted_at, finalized_at, native_gas_id)
  SELECT kind, landed_tx_id, id, run_id, network, mode, fee_wallet, token, target_token, amount_in, route, quote_amount_out, min_amount_out, quote_value_micro, price_impact_bps, quote, approval_tx_id, tx_id, raw_tx, evm_nonce, expires_at, amount_out, token_balance_before, target_balance_before, target_balance_after, state, reason, created_at, updated_at, submitted_at, finalized_at, native_gas_id FROM fee_conversions;
DROP TABLE fee_conversions;
ALTER TABLE fee_conversions_next RENAME TO fee_conversions;

-- At most one unresolved send per wallet token. A retry must reconcile it first.
CREATE UNIQUE INDEX fee_conversions_one_open
  ON fee_conversions(network, token) WHERE state IN ('submitted', 'unknown');
CREATE UNIQUE INDEX fee_conversions_tx
  ON fee_conversions(network, tx_id) WHERE tx_id IS NOT NULL;
CREATE INDEX fee_conversions_recent ON fee_conversions(created_at);
CREATE INDEX fee_conversions_token ON fee_conversions(network, token, created_at);
CREATE INDEX fee_conversions_kind ON fee_conversions(network, kind, state);

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
  (OLD.kind IN ('claim', 'approval', 'bridge', 'buyback', 'burn') AND (NEW.quote IS NOT OLD.quote OR
    NEW.target_token IS NOT OLD.target_token OR NEW.evm_nonce IS NOT OLD.evm_nonce)) OR
  (OLD.kind IN ('bridge', 'buyback', 'burn') AND (NEW.route IS NOT OLD.route OR
    NEW.quote_value_micro IS NOT OLD.quote_value_micro))
BEGIN
  SELECT RAISE(ABORT, 'fee conversion identity is immutable');
END;

CREATE TRIGGER fee_conversions_no_delete
BEFORE DELETE ON fee_conversions
BEGIN
  SELECT RAISE(ABORT, 'fee conversion records are permanent');
END;

-- Unchanged from migration 0094: one insert commits the signed attempt and
-- its native reservation, or neither.
CREATE TRIGGER fee_conversion_commit_gas AFTER INSERT ON fee_conversions
WHEN NEW.native_gas_id IS NOT NULL
BEGIN
  UPDATE fee_native_gas SET state='signed',tx_id=NEW.tx_id,conversion_id=NEW.id
   WHERE id=NEW.native_gas_id AND state='reserved' AND network=NEW.network
     AND fee_wallet=NEW.fee_wallet AND (nonce=NEW.evm_nonce OR (NEW.network='solana' AND NEW.evm_nonce IS NULL)) AND run_id=NEW.run_id
     AND NEW.raw_tx IS NOT NULL
     AND EXISTS(SELECT 1 FROM fee_converter_locks WHERE network=NEW.network AND run_id=NEW.run_id AND expires_at>=NEW.submitted_at);
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'native gas reservation lost before signed commit') END;
END;
CREATE TRIGGER fee_replacement_commit_gas AFTER INSERT ON fee_send_replacements
WHEN NEW.native_gas_id IS NOT NULL
BEGIN
  UPDATE fee_native_gas SET state='signed',tx_id=NEW.tx_id,conversion_id=NEW.conversion_id
   WHERE id=NEW.native_gas_id AND state='reserved' AND network=NEW.network AND nonce=NEW.evm_nonce
     AND EXISTS(SELECT 1 FROM fee_converter_locks l WHERE l.network=fee_native_gas.network AND l.run_id=fee_native_gas.run_id AND l.expires_at>=NEW.created_at)
     AND EXISTS(SELECT 1 FROM fee_conversions c WHERE c.id=NEW.conversion_id AND c.fee_wallet=fee_native_gas.fee_wallet);
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'native gas reservation lost before replacement commit') END;
END;

-- The proven end of one finalized bridge deposit. `arrived`: the order was
-- filled on Robinhood Chain, read from DlnDestination at a finalized block;
-- its exact take amount becomes buy credit there. `refunded`: the order was
-- cancelled and its deposit claimed back on the source network, read from
-- DlnSource at a finalized block; its amount leaves the bridged total. A
-- deposit without a row here is still in transit. One row per deposit, so an
-- arrival is credited once and can never also be refunded.
CREATE TABLE fee_bridge_outcomes (
  bridge_id TEXT PRIMARY KEY CHECK (length(bridge_id) BETWEEN 8 AND 80),
  source_network TEXT NOT NULL CHECK (source_network IN ('base', 'ethereum', 'solana')),
  order_id TEXT NOT NULL UNIQUE CHECK (
    length(order_id) = 66 AND order_id GLOB '0x*' AND
    substr(order_id, 3) NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('arrived', 'refunded')),
  -- The arrival asset on Robinhood Chain, or the deposited asset for a refund.
  token TEXT NOT NULL CHECK (length(token) BETWEEN 32 AND 64),
  amount TEXT NOT NULL CHECK (
    amount GLOB '[1-9]*' AND amount NOT GLOB '*[^0-9]*'
  ),
  -- The network whose finalized block proves the outcome, and that block.
  evidence_network TEXT NOT NULL CHECK (evidence_network IN ('base', 'ethereum', 'robinhood', 'solana')),
  evidence_block INTEGER NOT NULL CHECK (evidence_block >= 0),
  evidence_block_hash TEXT NOT NULL CHECK (length(evidence_block_hash) BETWEEN 32 AND 128),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 8 AND 80),
  observed_at TEXT NOT NULL,
  CHECK ((outcome = 'arrived') = (evidence_network = 'robinhood')),
  CHECK (outcome <> 'refunded' OR evidence_network = source_network)
) STRICT;
CREATE INDEX fee_bridge_outcomes_token ON fee_bridge_outcomes(outcome, token);

-- An outcome needs its finalized live deposit, its recorded order and amount,
-- and the lease of the network that proves it.
CREATE TRIGGER fee_bridge_outcomes_bound BEFORE INSERT ON fee_bridge_outcomes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM fee_conversions c
     WHERE c.id = NEW.bridge_id AND c.kind = 'bridge' AND c.mode = 'live'
       AND c.state = 'finalized' AND c.network = NEW.source_network
       AND json_extract(c.quote, '$.orderId') = NEW.order_id
       AND ((NEW.outcome = 'arrived' AND c.target_token = NEW.token
              AND json_extract(c.quote, '$.takeAmount') = NEW.amount) OR
            (NEW.outcome = 'refunded' AND c.token = NEW.token AND c.amount_out = NEW.amount))
  ) THEN RAISE(ABORT, 'bridge outcome differs from its finalized deposit') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM fee_converter_locks l
     WHERE l.network = NEW.evidence_network AND l.run_id = NEW.run_id
       AND l.expires_at >= NEW.observed_at
  ) THEN RAISE(ABORT, 'bridge outcome lost its network lease') END;
END;
CREATE TRIGGER fee_bridge_outcomes_immutable BEFORE UPDATE ON fee_bridge_outcomes
BEGIN SELECT RAISE(ABORT, 'bridge outcome is immutable'); END;
CREATE TRIGGER fee_bridge_outcomes_no_delete BEFORE DELETE ON fee_bridge_outcomes
BEGIN SELECT RAISE(ABORT, 'bridge outcomes are permanent'); END;

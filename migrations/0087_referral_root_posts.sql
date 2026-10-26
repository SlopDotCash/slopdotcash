-- Referral root posts (workers/referral-accrual live mode; PRD section 11,
-- "Referral program", proposed). The poster signs one ReferralDistributor
-- postRoot transaction per filed epoch with a root. Before broadcast it
-- records the signed bytes here, so an uncertain send is resent unchanged
-- instead of signed again. `epoch` is the index the contract assigned, which
-- can differ from the file's own epoch when earlier files had no leaves.
-- Rows are permanent; only the state moves forward.

CREATE TABLE referral_root_posts (
  id TEXT PRIMARY KEY CHECK (id GLOB 'rpost_*' AND length(id) BETWEEN 12 AND 80),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 8 AND 80),
  period TEXT NOT NULL REFERENCES referral_accrual_files(period),
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  network TEXT NOT NULL CHECK (network IN ('robinhood-testnet', 'robinhood-mainnet')),
  distributor TEXT NOT NULL CHECK (length(distributor) = 42 AND distributor GLOB '0x*'),
  token TEXT NOT NULL CHECK (length(token) = 42 AND token GLOB '0x*'),
  poster TEXT NOT NULL CHECK (length(poster) = 42 AND poster GLOB '0x*'),
  merkle_root TEXT NOT NULL CHECK (length(merkle_root) = 66 AND merkle_root GLOB '0x*'),
  total_base TEXT NOT NULL CHECK (total_base GLOB '[0-9]*' AND total_base NOT GLOB '*[^0-9]*' AND length(total_base) <= 78),
  tx_id TEXT NOT NULL CHECK (length(tx_id) = 66 AND tx_id GLOB '0x*'),
  -- The signed transaction is public once broadcast. Kept only for rebroadcast.
  raw_tx TEXT NOT NULL CHECK (length(raw_tx) BETWEEN 10 AND 16384),
  evm_nonce INTEGER NOT NULL CHECK (evm_nonce >= 0),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'unknown', 'finalized', 'failed', 'voided')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  block_number TEXT CHECK (block_number IS NULL OR (block_number GLOB '[0-9]*' AND block_number NOT GLOB '*[^0-9]*')),
  -- The operator acknowledges an owner void (after recording the correction)
  -- before the poster may post again. Set once, outside the job.
  void_acknowledged_at TEXT,
  void_acknowledgement TEXT CHECK (void_acknowledgement IS NULL OR length(void_acknowledgement) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  finalized_at TEXT,
  CHECK ((state IN ('finalized', 'voided')) = (finalized_at IS NOT NULL AND block_number IS NOT NULL)),
  CHECK (state <> 'failed' OR reason IS NOT NULL),
  CHECK ((void_acknowledged_at IS NULL) = (void_acknowledgement IS NULL)),
  CHECK (void_acknowledged_at IS NULL OR state = 'voided')
) STRICT;

-- One post in flight per network; a retry must reconcile it first.
CREATE UNIQUE INDEX referral_root_posts_one_open
  ON referral_root_posts(network) WHERE state IN ('submitted', 'unknown');
-- One accepted post per contract epoch per network.
CREATE UNIQUE INDEX referral_root_posts_one_per_epoch
  ON referral_root_posts(network, epoch) WHERE state IN ('submitted', 'unknown', 'finalized', 'voided');
CREATE UNIQUE INDEX referral_root_posts_tx ON referral_root_posts(network, tx_id);
CREATE INDEX referral_root_posts_period ON referral_root_posts(network, period, created_at);

-- Identity and signed bytes never change; a failed post is final; a finalized
-- post may only become voided (and then acknowledged).
CREATE TRIGGER referral_root_posts_identity BEFORE UPDATE ON referral_root_posts
WHEN NEW.id <> OLD.id OR NEW.run_id <> OLD.run_id OR NEW.period <> OLD.period
  OR NEW.epoch <> OLD.epoch OR NEW.network <> OLD.network OR NEW.distributor <> OLD.distributor
  OR NEW.token <> OLD.token OR NEW.poster <> OLD.poster OR NEW.merkle_root <> OLD.merkle_root
  OR NEW.total_base <> OLD.total_base OR NEW.tx_id <> OLD.tx_id OR NEW.raw_tx <> OLD.raw_tx
  OR NEW.evm_nonce <> OLD.evm_nonce OR NEW.created_at <> OLD.created_at
  OR NEW.submitted_at <> OLD.submitted_at
BEGIN SELECT RAISE(ABORT, 'referral root post identity is immutable'); END;
CREATE TRIGGER referral_root_posts_terminal BEFORE UPDATE ON referral_root_posts
WHEN OLD.state = 'failed'
  OR (OLD.state = 'finalized' AND NEW.state <> 'finalized' AND NEW.state <> 'voided')
  OR (OLD.state = 'voided' AND NEW.state <> 'voided')
  OR (OLD.void_acknowledged_at IS NOT NULL AND NEW.void_acknowledged_at IS NOT OLD.void_acknowledged_at)
BEGIN SELECT RAISE(ABORT, 'referral root post state is final'); END;
CREATE TRIGGER referral_root_posts_no_delete BEFORE DELETE ON referral_root_posts
BEGIN SELECT RAISE(ABORT, 'referral root posts are permanent'); END;

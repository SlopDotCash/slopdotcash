-- Same-nonce fee replacements for EVM fee claims and conversions (owner
-- decision of 25 October 2026). A journaled send that stays unmined while
-- the network fee is above its signed maximum fee is signed again with the
-- same nonce, recipient, calldata and value, and a higher fee. Each
-- replacement is stored here before it is broadcast. Rows are permanent and
-- cannot change. The original send stays in fee_conversions unchanged.

CREATE TABLE fee_send_replacements (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
  -- fee_conversions.id. No foreign key: migrations rebuild fee_conversions
  -- with DROP TABLE, which a foreign key would refuse once rows exist.
  conversion_id TEXT NOT NULL CHECK (length(conversion_id) BETWEEN 8 AND 80),
  network TEXT NOT NULL CHECK (network IN ('base', 'ethereum', 'robinhood')),
  -- 1 is the first replacement. The original send is attempt 0.
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 32),
  evm_nonce INTEGER NOT NULL CHECK (evm_nonce >= 0),
  tx_id TEXT NOT NULL CHECK (length(tx_id) = 66),
  raw_tx TEXT NOT NULL CHECK (length(raw_tx) <= 262146),
  -- Wei, as exact decimal strings.
  max_fee_per_gas TEXT NOT NULL CHECK (
    max_fee_per_gas GLOB '[0-9]*' AND max_fee_per_gas NOT GLOB '*[^0-9]*'
  ),
  max_priority_fee_per_gas TEXT NOT NULL CHECK (
    max_priority_fee_per_gas GLOB '[0-9]*' AND
    max_priority_fee_per_gas NOT GLOB '*[^0-9]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (conversion_id, attempt)
) STRICT;

CREATE UNIQUE INDEX fee_send_replacements_tx
  ON fee_send_replacements(network, tx_id);

CREATE TRIGGER fee_send_replacements_immutable
BEFORE UPDATE ON fee_send_replacements
BEGIN
  SELECT RAISE(ABORT, 'fee send replacements are permanent');
END;

CREATE TRIGGER fee_send_replacements_no_delete
BEFORE DELETE ON fee_send_replacements
BEGIN
  SELECT RAISE(ABORT, 'fee send replacements are permanent');
END;

-- The transaction that the finalized or failed outcome comes from: the
-- original send or one of its replacements. Null for rows settled before
-- this migration and for rows without a send.
ALTER TABLE fee_conversions ADD COLUMN landed_tx_id TEXT
  CHECK (landed_tx_id IS NULL OR length(landed_tx_id) BETWEEN 32 AND 128);

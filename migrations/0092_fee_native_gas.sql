-- PRD section 6: gas liabilities are separate from token conversion limits.
-- Decimal text preserves exact wei beyond JavaScript's safe integer range.
ALTER TABLE fee_converter_locks ADD COLUMN gas_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE fee_native_gas (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK(network IN ('base','ethereum','robinhood')),
  fee_wallet TEXT NOT NULL,
  nonce INTEGER NOT NULL CHECK(nonce >= 0),
  intent_hash TEXT NOT NULL,
  run_id TEXT NOT NULL,
  maximum_wei TEXT NOT NULL,
  per_transaction_wei TEXT NOT NULL,
  per_day_wei TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','signed','abandoned')),
  tx_id TEXT,
  conversion_id TEXT,
  created_at TEXT NOT NULL,
  actual_wei TEXT,
  settled_day TEXT,
  receipt_block_hash TEXT,
  CHECK((actual_wei IS NULL) = (settled_day IS NULL)),
  CHECK((state='signed') = (tx_id IS NOT NULL)),
  CHECK(maximum_wei GLOB '[0-9]*' AND maximum_wei NOT GLOB '*[^0-9]*'),
  CHECK(actual_wei IS NULL OR (actual_wei GLOB '[0-9]*' AND actual_wei NOT GLOB '*[^0-9]*'))
) STRICT;
CREATE INDEX fee_native_gas_network ON fee_native_gas(network);
CREATE UNIQUE INDEX fee_native_gas_hash ON fee_native_gas(network,tx_id) WHERE tx_id IS NOT NULL;
CREATE TRIGGER fee_native_gas_insert_revision AFTER INSERT ON fee_native_gas
BEGIN UPDATE fee_converter_locks SET gas_revision=gas_revision+1 WHERE network=NEW.network; END;
CREATE TRIGGER fee_native_gas_update_revision AFTER UPDATE ON fee_native_gas
BEGIN UPDATE fee_converter_locks SET gas_revision=gas_revision+1 WHERE network=NEW.network; END;
CREATE TRIGGER fee_native_gas_immutable BEFORE UPDATE ON fee_native_gas
WHEN NEW.id IS NOT OLD.id OR NEW.network IS NOT OLD.network OR NEW.fee_wallet IS NOT OLD.fee_wallet
  OR NEW.nonce IS NOT OLD.nonce OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.run_id IS NOT OLD.run_id
  OR NEW.maximum_wei IS NOT OLD.maximum_wei OR NEW.per_transaction_wei IS NOT OLD.per_transaction_wei
  OR NEW.per_day_wei IS NOT OLD.per_day_wei OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.state!='reserved' AND NEW.state IS NOT OLD.state)
  OR (OLD.tx_id IS NOT NULL AND (NEW.tx_id IS NOT OLD.tx_id OR NEW.conversion_id IS NOT OLD.conversion_id))
  OR (OLD.actual_wei IS NOT NULL AND (NEW.actual_wei IS NOT OLD.actual_wei OR NEW.settled_day IS NOT OLD.settled_day OR NEW.receipt_block_hash IS NOT OLD.receipt_block_hash))
BEGIN SELECT RAISE(ABORT,'native gas evidence is immutable'); END;
CREATE TRIGGER fee_native_gas_no_delete BEFORE DELETE ON fee_native_gas
BEGIN SELECT RAISE(ABORT,'native gas evidence is permanent'); END;

ALTER TABLE fee_conversions ADD COLUMN native_gas_id TEXT;
ALTER TABLE fee_send_replacements ADD COLUMN native_gas_id TEXT;
-- One authoritative insert commits both the signed attempt and its reservation.
-- RAISE rolls back the entire insert if a stale holder or invalid binding loses.
CREATE TRIGGER fee_conversion_commit_gas AFTER INSERT ON fee_conversions
WHEN NEW.native_gas_id IS NOT NULL
BEGIN
  UPDATE fee_native_gas SET state='signed',tx_id=NEW.tx_id,conversion_id=NEW.id
   WHERE id=NEW.native_gas_id AND state='reserved' AND network=NEW.network
     AND fee_wallet=NEW.fee_wallet AND nonce=NEW.evm_nonce AND run_id=NEW.run_id
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

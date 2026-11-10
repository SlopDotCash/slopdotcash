-- A Solana binding txid is not a payment receipt. Writing it into
-- payment_attempts.transaction_id held the next payment dispatch for the
-- same attempt (the dispatch guard only matches a NULL or equal
-- transaction_id, so the broadcast payment could never be recorded) and
-- let reconcile present the bind transaction as the payment receipt.
-- The binding txid and the block height it expires at live in their own
-- columns; transaction_id stays the payment receipt. The private ledger
-- (security_payment_attempts) gets the same columns: the handler rewrites
-- the table name, so both ledgers stay in step.
ALTER TABLE payment_attempts ADD COLUMN binding_transaction_id TEXT;
ALTER TABLE payment_attempts ADD COLUMN binding_last_valid_block_height INTEGER
  CHECK(binding_last_valid_block_height IS NULL OR binding_last_valid_block_height > 0);
ALTER TABLE security_payment_attempts ADD COLUMN binding_transaction_id TEXT;
ALTER TABLE security_payment_attempts ADD COLUMN binding_last_valid_block_height INTEGER
  CHECK(binding_last_valid_block_height IS NULL OR binding_last_valid_block_height > 0);

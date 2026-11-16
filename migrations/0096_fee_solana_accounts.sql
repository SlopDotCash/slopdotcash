-- Preserve the finalized lookup mapping reviewed before a versioned signature.
-- Legacy attempts retain NULL and reconcile using their signed static keys.
ALTER TABLE fee_native_gas ADD COLUMN solana_account_proof TEXT
  CHECK(solana_account_proof IS NULL OR (network='solana' AND json_valid(solana_account_proof)));
CREATE TRIGGER fee_native_solana_accounts_immutable BEFORE UPDATE ON fee_native_gas
WHEN NEW.solana_account_proof IS NOT OLD.solana_account_proof
BEGIN SELECT RAISE(ABORT,'Solana account evidence is immutable'); END;

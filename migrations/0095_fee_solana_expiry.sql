-- Owner-approved two-provider expiry recovery, #905, PRD section 6.
ALTER TABLE fee_native_gas ADD COLUMN solana_blockhash_slot INTEGER;
CREATE TRIGGER fee_native_solana_anchor_immutable BEFORE UPDATE ON fee_native_gas
WHEN NEW.solana_blockhash_slot IS NOT OLD.solana_blockhash_slot
BEGIN SELECT RAISE(ABORT,'Solana blockhash anchor is immutable'); END;
CREATE TABLE fee_solana_expiry_proofs (
  tx_id TEXT PRIMARY KEY,
  fee_wallet TEXT NOT NULL,
  run_id TEXT NOT NULL,
  proof_json TEXT NOT NULL CHECK(json_valid(proof_json)),
  proof_sha256 TEXT NOT NULL CHECK(length(proof_sha256)=64),
  observed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER fee_solana_expiry_commit AFTER INSERT ON fee_solana_expiry_proofs
BEGIN
  UPDATE fee_native_gas SET actual_wei='0',settled_day=substr(NEW.observed_at,1,10),receipt_block_hash='expiry:'||NEW.proof_sha256
  WHERE network='solana' AND tx_id=NEW.tx_id AND fee_wallet=NEW.fee_wallet
    AND state='signed' AND actual_wei IS NULL AND solana_blockhash_slot IS NOT NULL
    AND EXISTS(SELECT 1 FROM fee_converter_locks WHERE network='solana' AND run_id=NEW.run_id AND expires_at>=NEW.observed_at);
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'Solana expiry resolution lost its lease or signed liability') END;
END;
CREATE TRIGGER fee_solana_expiry_immutable BEFORE UPDATE ON fee_solana_expiry_proofs
BEGIN SELECT RAISE(ABORT,'Solana expiry evidence is immutable'); END;
CREATE TRIGGER fee_solana_expiry_no_delete BEFORE DELETE ON fee_solana_expiry_proofs
BEGIN SELECT RAISE(ABORT,'Solana expiry evidence is permanent'); END;

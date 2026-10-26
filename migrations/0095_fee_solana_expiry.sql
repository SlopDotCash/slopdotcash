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

-- Durable positive block-history coverage; a null transaction index is insufficient.
CREATE TABLE fee_solana_expiry_scans (
  tx_id TEXT NOT NULL,
  operator TEXT NOT NULL,
  revision INTEGER NOT NULL,
  scan_json TEXT NOT NULL CHECK(json_valid(scan_json)),
  PRIMARY KEY(tx_id,operator)
) STRICT;
CREATE TABLE fee_solana_expiry_scan_steps (
  tx_id TEXT NOT NULL,
  operator TEXT NOT NULL,
  prior_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK(revision=prior_revision+1),
  fee_wallet TEXT NOT NULL,
  run_id TEXT NOT NULL,
  scan_json TEXT NOT NULL CHECK(json_valid(scan_json)),
  page_json TEXT NOT NULL CHECK(json_valid(page_json)),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(tx_id,operator,revision)
) STRICT;
CREATE TRIGGER fee_solana_scan_step_commit AFTER INSERT ON fee_solana_expiry_scan_steps
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM fee_native_gas g JOIN fee_converter_locks l ON l.network=g.network
    WHERE g.network='solana' AND g.tx_id=NEW.tx_id AND g.fee_wallet=NEW.fee_wallet
      AND g.state='signed' AND g.actual_wei IS NULL
      AND l.run_id=NEW.run_id AND l.expires_at>=NEW.observed_at
  ) THEN RAISE(ABORT,'Solana coverage scan lost its lease or liability') END;
  INSERT INTO fee_solana_expiry_scans(tx_id,operator,revision,scan_json)
  SELECT NEW.tx_id,NEW.operator,NEW.revision,NEW.scan_json
  WHERE NEW.prior_revision=0 OR EXISTS(SELECT 1 FROM fee_solana_expiry_scans WHERE tx_id=NEW.tx_id AND operator=NEW.operator AND revision=NEW.prior_revision)
  ON CONFLICT(tx_id,operator) DO UPDATE SET revision=excluded.revision,scan_json=excluded.scan_json
  WHERE fee_solana_expiry_scans.revision=NEW.prior_revision;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'Solana coverage scan revision changed') END;
END;
CREATE TRIGGER fee_solana_scan_steps_immutable BEFORE UPDATE ON fee_solana_expiry_scan_steps
BEGIN SELECT RAISE(ABORT,'Solana coverage evidence is immutable'); END;
CREATE TRIGGER fee_solana_scan_steps_no_delete BEFORE DELETE ON fee_solana_expiry_scan_steps
BEGIN SELECT RAISE(ABORT,'Solana coverage evidence is permanent'); END;

-- Bind zero-cost settlement to both retained completed scans in the same commit.
CREATE TRIGGER fee_solana_expiry_coverage_required BEFORE INSERT ON fee_solana_expiry_proofs
BEGIN
  SELECT CASE WHEN json_array_length(NEW.proof_json,'$.providers')!=2
    OR json_extract(NEW.proof_json,'$.txId') IS NOT NEW.tx_id
    OR json_extract(NEW.proof_json,'$.providers[0].operator') IS json_extract(NEW.proof_json,'$.providers[1].operator')
    OR (SELECT count(*) FROM json_each(NEW.proof_json,'$.providers') p
      JOIN fee_solana_expiry_scans s ON s.tx_id=NEW.tx_id AND s.operator=json_extract(p.value,'$.operator')
      WHERE json_extract(s.scan_json,'$.complete')=1
        AND s.scan_json=json_extract(p.value,'$.coverage')
        AND json_extract(s.scan_json,'$.blockhash')=json_extract(NEW.proof_json,'$.blockhash')
        AND json_extract(s.scan_json,'$.blockhashSlot')=json_extract(NEW.proof_json,'$.blockhashSlot'))!=2
  THEN RAISE(ABORT,'Solana expiry lacks retained complete block-history coverage') END;
END;

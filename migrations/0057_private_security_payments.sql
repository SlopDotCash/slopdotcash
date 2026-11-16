-- Private bounty settlement reuses the payment engine in separate tables.
-- Public queries and ordinary notification paths never select these records.

CREATE TABLE security_payment_events (
 network TEXT NOT NULL, transaction_id TEXT NOT NULL, event_index INTEGER NOT NULL,
 block_id TEXT NOT NULL, kind TEXT NOT NULL, obligation_id TEXT NOT NULL,
 evidence_json TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(network,transaction_id,event_index)
) STRICT;

CREATE TABLE security_payment_outbox (
 obligation_id TEXT PRIMARY KEY REFERENCES security_payment_obligations(id),
 state TEXT NOT NULL CHECK(state IN ('ready','processing','submitted','paid','held')),
 lease_token TEXT, lease_until TEXT, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE security_payment_attempts (
 id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL REFERENCES security_payment_obligations(id),
 claim_id TEXT NOT NULL REFERENCES wallet_claims(id), created_at TEXT NOT NULL,
 transaction_id TEXT, state TEXT NOT NULL CHECK(state IN ('prepared','submitted','finalized','unknown','failed')),
 UNIQUE(obligation_id,transaction_id)
) STRICT;

CREATE TABLE security_payment_chain_cursors (
 project_id TEXT NOT NULL, network TEXT NOT NULL, position TEXT NOT NULL, synced_at TEXT NOT NULL,
 PRIMARY KEY(project_id,network)
) STRICT;

CREATE TABLE security_payment_attempt_failures (
 attempt_id TEXT PRIMARY KEY REFERENCES security_payment_attempts(id),
 transaction_id TEXT, observed_at TEXT NOT NULL, evidence_json TEXT NOT NULL
) STRICT;

CREATE TABLE security_payment_solana_scans (
 project_id TEXT NOT NULL, network TEXT NOT NULL, generation TEXT NOT NULL,
 until_signature TEXT, before_signature TEXT, next_page INTEGER NOT NULL DEFAULT 0,
 ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,network)
) STRICT;

CREATE TABLE security_payment_solana_scan_pages (
 project_id TEXT NOT NULL, network TEXT NOT NULL, generation TEXT NOT NULL,
 page INTEGER NOT NULL, signatures_json TEXT NOT NULL,
 PRIMARY KEY(project_id,network,generation,page)
) STRICT;

CREATE TABLE security_payment_obligations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, github_user_id TEXT NOT NULL,
 network TEXT NOT NULL, chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood','ethereum')),
 vault TEXT NOT NULL,
 asset_address TEXT NOT NULL CHECK(length(asset_address) BETWEEN 32 AND 44),
 asset_decimals INTEGER NOT NULL CHECK(asset_decimals BETWEEN 0 AND 36),
 gross_base TEXT NOT NULL CHECK(length(gross_base) BETWEEN 1 AND 39 AND gross_base GLOB '[1-9]*' AND gross_base NOT GLOB '*[^0-9]*'),
 fee_base TEXT NOT NULL CHECK(length(fee_base) BETWEEN 1 AND 39 AND (fee_base='0' OR fee_base GLOB '[1-9]*') AND fee_base NOT GLOB '*[^0-9]*'),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 state TEXT NOT NULL CHECK(state IN ('reserved','paid')),
 created_at TEXT NOT NULL, paid_transaction TEXT
) STRICT;

CREATE TABLE security_vault_snapshots (
 project_id TEXT NOT NULL, network TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood','ethereum')),
 vault TEXT NOT NULL,
 asset_address TEXT NOT NULL CHECK(length(asset_address) BETWEEN 32 AND 44),
 asset_decimals INTEGER NOT NULL CHECK(asset_decimals BETWEEN 0 AND 36),
 total_deposited TEXT NOT NULL, total_paid TEXT NOT NULL,
 total_payout_fees TEXT NOT NULL, total_gross_withdrawn TEXT NOT NULL,
 total_withdrawal_fees TEXT NOT NULL, total_service_fees TEXT NOT NULL,
 free_balance TEXT, reserved_principal TEXT, reserved_fees TEXT,
 accrued_fees TEXT, reserved TEXT,
 block_number TEXT NOT NULL CHECK(length(block_number) BETWEEN 1 AND 18 AND block_number NOT GLOB '*[^0-9]*'),
 block_time TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(project_id,network,vault),
 CHECK(total_deposited NOT GLOB '*[^0-9]*' AND total_paid NOT GLOB '*[^0-9]*'
  AND total_payout_fees NOT GLOB '*[^0-9]*' AND total_gross_withdrawn NOT GLOB '*[^0-9]*'
  AND total_withdrawal_fees NOT GLOB '*[^0-9]*' AND total_service_fees NOT GLOB '*[^0-9]*'
  AND coalesce(free_balance,'0') NOT GLOB '*[^0-9]*' AND coalesce(reserved_principal,'0') NOT GLOB '*[^0-9]*'
  AND coalesce(reserved_fees,'0') NOT GLOB '*[^0-9]*' AND coalesce(accrued_fees,'0') NOT GLOB '*[^0-9]*'
  AND coalesce(reserved,'0') NOT GLOB '*[^0-9]*'
  AND length(total_deposited) BETWEEN 1 AND 39 AND length(total_paid) BETWEEN 1 AND 39
  AND length(total_payout_fees) BETWEEN 1 AND 39 AND length(total_gross_withdrawn) BETWEEN 1 AND 39
  AND length(total_withdrawal_fees) BETWEEN 1 AND 39 AND length(total_service_fees) BETWEEN 1 AND 39)
) STRICT;

CREATE UNIQUE INDEX security_payment_event_once ON security_payment_events(obligation_id,kind);

CREATE INDEX security_payment_actor ON security_payment_obligations(github_user_id,chain,state);

CREATE UNIQUE INDEX security_payment_source_once ON security_payment_obligations(network,vault,source_digest);

CREATE INDEX security_vault_snapshots_project ON security_vault_snapshots(project_id);

CREATE TRIGGER security_payment_events_no_update BEFORE UPDATE ON security_payment_events BEGIN SELECT RAISE(ABORT,'payment evidence immutable'); END;

CREATE TRIGGER security_payment_events_no_delete BEFORE DELETE ON security_payment_events BEGIN SELECT RAISE(ABORT,'payment evidence permanent'); END;

CREATE TRIGGER security_payment_attempt_failures_no_update BEFORE UPDATE ON security_payment_attempt_failures
BEGIN SELECT RAISE(ABORT,'attempt failure evidence immutable'); END;

CREATE TRIGGER security_payment_attempt_failures_no_delete BEFORE DELETE ON security_payment_attempt_failures
BEGIN SELECT RAISE(ABORT,'attempt failure evidence permanent'); END;

CREATE TRIGGER security_payment_obligation_identity_immutable
BEFORE UPDATE ON security_payment_obligations
WHEN NEW.id != OLD.id OR NEW.project_id != OLD.project_id OR NEW.github_user_id != OLD.github_user_id
 OR NEW.network != OLD.network OR NEW.chain != OLD.chain OR NEW.vault != OLD.vault
 OR NEW.asset_address != OLD.asset_address OR NEW.asset_decimals != OLD.asset_decimals
 OR NEW.gross_base != OLD.gross_base OR NEW.fee_base != OLD.fee_base OR NEW.source_digest != OLD.source_digest
 OR (OLD.state='paid' AND (NEW.state!='paid' OR NEW.paid_transaction!=OLD.paid_transaction))
BEGIN SELECT RAISE(ABORT,'immutable payment obligation'); END;

CREATE TRIGGER security_payment_project_network_locked BEFORE INSERT ON security_payment_obligations
WHEN EXISTS(SELECT 1 FROM security_payment_obligations WHERE project_id=NEW.project_id AND (network!=NEW.network OR chain!=NEW.chain OR vault!=NEW.vault OR asset_address!=NEW.asset_address OR asset_decimals!=NEW.asset_decimals))
BEGIN SELECT RAISE(ABORT,'project settlement locked'); END;

CREATE TRIGGER security_vault_snapshots_asset_fixed BEFORE UPDATE ON security_vault_snapshots
WHEN NEW.project_id!=OLD.project_id OR NEW.network!=OLD.network OR NEW.vault!=OLD.vault
 OR NEW.chain!=OLD.chain OR NEW.asset_address!=OLD.asset_address OR NEW.asset_decimals!=OLD.asset_decimals
 OR CAST(NEW.block_number AS INTEGER) < CAST(OLD.block_number AS INTEGER)
BEGIN SELECT RAISE(ABORT,'vault snapshot identity fixed and block monotonic'); END;

CREATE TABLE security_settlements (
 case_id TEXT PRIMARY KEY REFERENCES security_cases(id),
 obligation_id TEXT NOT NULL UNIQUE,
 source_digest TEXT NOT NULL UNIQUE CHECK(length(source_digest)=64),
 network TEXT NOT NULL, vault TEXT NOT NULL, asset TEXT NOT NULL,
 asset_decimals INTEGER NOT NULL,
 gross_base TEXT NOT NULL, fee_base TEXT NOT NULL,
 reporter_github_id TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 case_revision INTEGER NOT NULL,
 deployment TEXT NOT NULL CHECK(json_valid(deployment)),
 UNIQUE(network,vault,source_digest)
) STRICT;
CREATE TRIGGER security_settlement_no_update BEFORE UPDATE ON security_settlements
BEGIN SELECT RAISE(ABORT,'private settlement immutable'); END;
CREATE TRIGGER security_settlement_no_delete BEFORE DELETE ON security_settlements
BEGIN SELECT RAISE(ABORT,'private settlement permanent'); END;

CREATE TABLE security_payment_consents (
 case_id TEXT NOT NULL REFERENCES security_cases(id),
 deployment TEXT NOT NULL CHECK(json_valid(deployment)),
 reporter_github_id TEXT NOT NULL,
 accepted_at TEXT NOT NULL,
 case_revision INTEGER NOT NULL,
 PRIMARY KEY(case_id,case_revision)
) STRICT;
CREATE TRIGGER security_payment_consent_no_update BEFORE UPDATE ON security_payment_consents
BEGIN SELECT RAISE(ABORT,'payment consent immutable'); END;
CREATE TRIGGER security_payment_consent_no_delete BEFORE DELETE ON security_payment_consents
BEGIN SELECT RAISE(ABORT,'payment consent permanent'); END;

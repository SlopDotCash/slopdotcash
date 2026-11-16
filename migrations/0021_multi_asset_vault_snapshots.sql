-- Multi-asset payment accounting and the finalized vault totals cache.
--
-- 1. Amounts become base-unit integer text of the vault asset. A payment row
--    carries its asset address and decimals, so 6-decimal USDC, USDG and an
--    18-decimal ERC-20 are never read with the wrong scale. Existing rows were
--    written only for the reviewed network asset (escrow-policy.mjs requires
--    deployment.asset = network.asset), and every such asset has 6 decimals.
--    The copy names each reviewed network. A row on any other network makes
--    the migration fail (NOT NULL), so no row gets a guessed asset.
-- 2. The chain CHECK accepts 'ethereum' on wallet_claims,
--    payment_obligations and payment_wallet_proposals.
--    payment_direct_transfers and wallet_observations keep their chains:
--    the reviewed importer writes only Solana USDC disclosures and legacy
--    README observations.
-- 3. vault_snapshots caches the public vault counters, read at the finalized
--    block by the payments worker. Pages read this table, never the chain.
--
-- The rebuild follows 0017: copy each table into a plain holding table, drop
-- the original (triggers first), create the replacement under its own name,
-- re-insert, drop the holding table, and recreate indexes and triggers. The
-- replacement is never renamed into place, because ALTER TABLE ... RENAME does
-- not clear the deferred foreign key count that DROP TABLE adds in D1.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

-- wallet_claims (0017)
CREATE TABLE wallet_claims_0021_copy (
  id TEXT, github_user_id TEXT, github_login TEXT, wallet_address TEXT,
  source TEXT, issue_repository TEXT, issue_number INTEGER,
  source_body_sha256 TEXT, observed_at TEXT, record_sha256 TEXT,
  supersedes_claim_id TEXT, created_at TEXT, chain TEXT
) STRICT;
INSERT INTO wallet_claims_0021_copy (
  id, github_user_id, github_login, wallet_address, source,
  issue_repository, issue_number, source_body_sha256, observed_at,
  record_sha256, supersedes_claim_id, created_at, chain
)
SELECT
  id, github_user_id, github_login, wallet_address, source,
  issue_repository, issue_number, source_body_sha256, observed_at,
  record_sha256, supersedes_claim_id, created_at, chain
FROM wallet_claims;
DROP TRIGGER wallet_claims_no_update;
DROP TRIGGER wallet_claims_no_delete;
DROP TRIGGER wallet_claims_successor_keeps_chain;
DROP TABLE wallet_claims;
CREATE TABLE wallet_claims (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('github_issue', 'profile_readme', 'd1_registry')),
  issue_repository TEXT,
  issue_number INTEGER,
  source_body_sha256 TEXT NOT NULL CHECK (length(source_body_sha256) = 64),
  observed_at TEXT NOT NULL,
  record_sha256 TEXT NOT NULL UNIQUE CHECK (length(record_sha256) = 64),
  supersedes_claim_id TEXT REFERENCES wallet_claims(id),
  created_at TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana' CHECK (chain IN ('base','solana','robinhood','ethereum')),
  CHECK (
    source != 'github_issue' OR
    (issue_repository IS NOT NULL AND issue_number IS NOT NULL AND issue_number > 0)
  ),
  CHECK (
    source = 'github_issue' OR
    (issue_repository IS NULL AND issue_number IS NULL)
  )
) STRICT;
INSERT INTO wallet_claims (
  id, github_user_id, github_login, wallet_address, source,
  issue_repository, issue_number, source_body_sha256, observed_at,
  record_sha256, supersedes_claim_id, created_at, chain
)
SELECT
  id, github_user_id, github_login, wallet_address, source,
  issue_repository, issue_number, source_body_sha256, observed_at,
  record_sha256, supersedes_claim_id, created_at, chain
FROM wallet_claims_0021_copy;
DROP TABLE wallet_claims_0021_copy;
CREATE UNIQUE INDEX wallet_claims_one_successor
ON wallet_claims(supersedes_claim_id)
WHERE supersedes_claim_id IS NOT NULL;
CREATE UNIQUE INDEX wallet_claims_one_root_per_actor
ON wallet_claims(github_user_id, chain)
WHERE supersedes_claim_id IS NULL;
CREATE INDEX wallet_claims_actor
ON wallet_claims(github_user_id, chain, observed_at);
CREATE TRIGGER wallet_claims_no_update
BEFORE UPDATE ON wallet_claims
BEGIN
  SELECT RAISE(ABORT, 'wallet claims are immutable');
END;
CREATE TRIGGER wallet_claims_no_delete
BEFORE DELETE ON wallet_claims
BEGIN
  SELECT RAISE(ABORT, 'wallet claims are permanent');
END;
CREATE TRIGGER wallet_claims_successor_keeps_chain
BEFORE INSERT ON wallet_claims
WHEN NEW.supersedes_claim_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM wallet_claims
    WHERE id = NEW.supersedes_claim_id
      AND chain = NEW.chain
      AND github_user_id = NEW.github_user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'wallet claim successor must keep its lineage');
END;

-- payment_obligations (0017): asset columns and base-unit amounts.
CREATE TABLE payment_obligations_0021_copy (
 id TEXT, project_id TEXT, github_user_id TEXT, network TEXT, chain TEXT,
 vault TEXT, gross_micro TEXT, fee_micro TEXT, source_digest TEXT,
 state TEXT, created_at TEXT, paid_transaction TEXT
) STRICT;
INSERT INTO payment_obligations_0021_copy (id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction)
SELECT id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction FROM payment_obligations;
DROP TRIGGER payment_obligation_identity_immutable;
DROP TRIGGER payment_project_network_locked;
DROP TABLE payment_obligations;
CREATE TABLE payment_obligations (
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
INSERT INTO payment_obligations (id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction)
SELECT id,project_id,github_user_id,network,chain,vault,
 CASE network
  WHEN 'base-sepolia' THEN '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
  WHEN 'base-mainnet' THEN '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  WHEN 'solana-devnet' THEN '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  WHEN 'solana-mainnet' THEN 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  WHEN 'robinhood-testnet' THEN '0x7e955252e15c84f5768b83c41a71f9eba181802f'
  WHEN 'robinhood-mainnet' THEN '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
 END,
 6,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction FROM payment_obligations_0021_copy;
DROP TABLE payment_obligations_0021_copy;
CREATE INDEX payment_actor ON payment_obligations(github_user_id,chain,state);
CREATE UNIQUE INDEX payment_source_once ON payment_obligations(network,vault,source_digest);
CREATE TRIGGER payment_obligation_identity_immutable
BEFORE UPDATE ON payment_obligations
WHEN NEW.id != OLD.id OR NEW.project_id != OLD.project_id OR NEW.github_user_id != OLD.github_user_id
 OR NEW.network != OLD.network OR NEW.chain != OLD.chain OR NEW.vault != OLD.vault
 OR NEW.asset_address != OLD.asset_address OR NEW.asset_decimals != OLD.asset_decimals
 OR NEW.gross_base != OLD.gross_base OR NEW.fee_base != OLD.fee_base OR NEW.source_digest != OLD.source_digest
 OR (OLD.state='paid' AND (NEW.state!='paid' OR NEW.paid_transaction!=OLD.paid_transaction))
BEGIN SELECT RAISE(ABORT,'immutable payment obligation'); END;
-- A project vault holds one asset, so its awards share one asset and scale.
CREATE TRIGGER payment_project_network_locked BEFORE INSERT ON payment_obligations
WHEN EXISTS(SELECT 1 FROM payment_obligations WHERE project_id=NEW.project_id AND (network!=NEW.network OR chain!=NEW.chain OR vault!=NEW.vault OR asset_address!=NEW.asset_address OR asset_decimals!=NEW.asset_decimals))
BEGIN SELECT RAISE(ABORT,'project settlement locked'); END;

-- payment_wallet_proposals (0017)
CREATE TABLE payment_wallet_proposals_0021_copy (
 id TEXT, github_user_id TEXT, chain TEXT, address TEXT, operator_id TEXT,
 reason TEXT, created_at TEXT
) STRICT;
INSERT INTO payment_wallet_proposals_0021_copy (id,github_user_id,chain,address,operator_id,reason,created_at)
SELECT id,github_user_id,chain,address,operator_id,reason,created_at FROM payment_wallet_proposals;
DROP TRIGGER payment_proposals_no_update;
DROP TRIGGER payment_proposals_no_delete;
DROP TABLE payment_wallet_proposals;
CREATE TABLE payment_wallet_proposals (
 id TEXT PRIMARY KEY, github_user_id TEXT NOT NULL, chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood','ethereum')),
 address TEXT NOT NULL, operator_id TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
INSERT INTO payment_wallet_proposals (id,github_user_id,chain,address,operator_id,reason,created_at)
SELECT id,github_user_id,chain,address,operator_id,reason,created_at FROM payment_wallet_proposals_0021_copy;
DROP TABLE payment_wallet_proposals_0021_copy;
CREATE TRIGGER payment_proposals_no_update BEFORE UPDATE ON payment_wallet_proposals BEGIN SELECT RAISE(ABORT,'wallet proposals immutable'); END;
CREATE TRIGGER payment_proposals_no_delete BEFORE DELETE ON payment_wallet_proposals BEGIN SELECT RAISE(ABORT,'wallet proposals permanent'); END;

-- vault_snapshots: one current row per project vault. Counters are base-unit
-- integer text (uint128 can exceed SQLite INTEGER). A counter the vault does
-- not have is NULL, never '0'. The worker writes a row only from a finalized
-- read; an older block never replaces a newer one, and the asset of a vault
-- never changes.
CREATE TABLE vault_snapshots (
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
CREATE INDEX vault_snapshots_project ON vault_snapshots(project_id);
CREATE TRIGGER vault_snapshots_asset_fixed BEFORE UPDATE ON vault_snapshots
WHEN NEW.project_id!=OLD.project_id OR NEW.network!=OLD.network OR NEW.vault!=OLD.vault
 OR NEW.chain!=OLD.chain OR NEW.asset_address!=OLD.asset_address OR NEW.asset_decimals!=OLD.asset_decimals
 OR CAST(NEW.block_number AS INTEGER) < CAST(OLD.block_number AS INTEGER)
BEGIN SELECT RAISE(ABORT,'vault snapshot identity fixed and block monotonic'); END;

PRAGMA foreign_keys = ON;

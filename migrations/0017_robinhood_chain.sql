-- Widen the settlement chain constraint to accept 'robinhood' on the five
-- tables that enumerate chains. SQLite cannot alter a CHECK in place, so each
-- table is rebuilt: copy every row aside into a plain holding table, drop the
-- original (triggers first), create the replacement under its own name with
-- the widened CHECK, re-insert every row, drop the holding table, and recreate
-- the indexes and triggers under their original names. Column order is
-- unchanged: several writers insert by position.
--
-- Foreign keys: D1 applies a migration in one transaction, where
-- PRAGMA foreign_keys = OFF has no effect. DROP TABLE on a referenced parent
-- performs an implicit delete, and under PRAGMA defer_foreign_keys = ON each
-- child row it orphans is counted as a deferred violation, checked at commit.
-- ALTER TABLE ... RENAME does not clear that count, so the replacement is
-- never renamed into place. Re-inserting the parent rows under the original
-- name does clear it. The holding tables declare no foreign keys, so they add
-- nothing to the count. PRAGMA foreign_keys = OFF covers an autocommit runner,
-- where defer_foreign_keys lapses after each statement.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

-- wallet_claims (0001, rebuilt 0003, chain added 0010)
CREATE TABLE wallet_claims_0017_copy (
  id TEXT, github_user_id TEXT, github_login TEXT, wallet_address TEXT,
  source TEXT, issue_repository TEXT, issue_number INTEGER,
  source_body_sha256 TEXT, observed_at TEXT, record_sha256 TEXT,
  supersedes_claim_id TEXT, created_at TEXT, chain TEXT
) STRICT;
INSERT INTO wallet_claims_0017_copy (
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
  chain TEXT NOT NULL DEFAULT 'solana' CHECK (chain IN ('base','solana','robinhood')),
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
FROM wallet_claims_0017_copy;
DROP TABLE wallet_claims_0017_copy;
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

-- payment_obligations (0011)
CREATE TABLE payment_obligations_0017_copy (
 id TEXT, project_id TEXT, github_user_id TEXT, network TEXT, chain TEXT,
 vault TEXT, gross_micro TEXT, fee_micro TEXT, source_digest TEXT,
 state TEXT, created_at TEXT, paid_transaction TEXT
) STRICT;
INSERT INTO payment_obligations_0017_copy (id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction)
SELECT id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction FROM payment_obligations;
DROP TRIGGER payment_obligation_identity_immutable;
DROP TRIGGER payment_project_network_locked;
DROP TABLE payment_obligations;
CREATE TABLE payment_obligations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, github_user_id TEXT NOT NULL,
 network TEXT NOT NULL, chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood')),
 vault TEXT NOT NULL, gross_micro TEXT NOT NULL, fee_micro TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 state TEXT NOT NULL CHECK(state IN ('reserved','paid')),
 created_at TEXT NOT NULL, paid_transaction TEXT
) STRICT;
INSERT INTO payment_obligations (id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction)
SELECT id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at,paid_transaction FROM payment_obligations_0017_copy;
DROP TABLE payment_obligations_0017_copy;
CREATE INDEX payment_actor ON payment_obligations(github_user_id,chain,state);
CREATE UNIQUE INDEX payment_source_once ON payment_obligations(network,vault,source_digest);
CREATE TRIGGER payment_obligation_identity_immutable
BEFORE UPDATE ON payment_obligations
WHEN NEW.id != OLD.id OR NEW.project_id != OLD.project_id OR NEW.github_user_id != OLD.github_user_id
 OR NEW.network != OLD.network OR NEW.chain != OLD.chain OR NEW.vault != OLD.vault
 OR NEW.gross_micro != OLD.gross_micro OR NEW.fee_micro != OLD.fee_micro OR NEW.source_digest != OLD.source_digest
 OR (OLD.state='paid' AND (NEW.state!='paid' OR NEW.paid_transaction!=OLD.paid_transaction))
BEGIN SELECT RAISE(ABORT,'immutable payment obligation'); END;
CREATE TRIGGER payment_project_network_locked BEFORE INSERT ON payment_obligations
WHEN EXISTS(SELECT 1 FROM payment_obligations WHERE project_id=NEW.project_id AND (network!=NEW.network OR chain!=NEW.chain OR vault!=NEW.vault))
BEGIN SELECT RAISE(ABORT,'project settlement locked'); END;

-- payment_wallet_proposals (0011)
CREATE TABLE payment_wallet_proposals_0017_copy (
 id TEXT, github_user_id TEXT, chain TEXT, address TEXT, operator_id TEXT,
 reason TEXT, created_at TEXT
) STRICT;
INSERT INTO payment_wallet_proposals_0017_copy (id,github_user_id,chain,address,operator_id,reason,created_at)
SELECT id,github_user_id,chain,address,operator_id,reason,created_at FROM payment_wallet_proposals;
DROP TRIGGER payment_proposals_no_update;
DROP TRIGGER payment_proposals_no_delete;
DROP TABLE payment_wallet_proposals;
CREATE TABLE payment_wallet_proposals (
 id TEXT PRIMARY KEY, github_user_id TEXT NOT NULL, chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood')),
 address TEXT NOT NULL, operator_id TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
INSERT INTO payment_wallet_proposals (id,github_user_id,chain,address,operator_id,reason,created_at)
SELECT id,github_user_id,chain,address,operator_id,reason,created_at FROM payment_wallet_proposals_0017_copy;
DROP TABLE payment_wallet_proposals_0017_copy;
CREATE TRIGGER payment_proposals_no_update BEFORE UPDATE ON payment_wallet_proposals BEGIN SELECT RAISE(ABORT,'wallet proposals immutable'); END;
CREATE TRIGGER payment_proposals_no_delete BEFORE DELETE ON payment_wallet_proposals BEGIN SELECT RAISE(ABORT,'wallet proposals permanent'); END;

-- payment_direct_transfers (0014)
CREATE TABLE payment_direct_transfers_0017_copy (
 network TEXT, transaction_id TEXT, project_id TEXT, contribution_month TEXT,
 github_user_id TEXT, github_node_id TEXT, github_login TEXT, chain TEXT,
 recipient TEXT, amount_micro TEXT, block_time TEXT, block_id TEXT,
 source_path TEXT, imported_at TEXT
) STRICT;
INSERT INTO payment_direct_transfers_0017_copy (network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at)
SELECT network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at FROM payment_direct_transfers;
DROP TRIGGER payment_direct_conflict;
DROP TRIGGER payment_direct_no_update;
DROP TRIGGER payment_direct_no_delete;
DROP TABLE payment_direct_transfers;
CREATE TABLE payment_direct_transfers (
 network TEXT NOT NULL, transaction_id TEXT NOT NULL,
 project_id TEXT NOT NULL, contribution_month TEXT NOT NULL,
 github_user_id TEXT NOT NULL, github_node_id TEXT NOT NULL,
 github_login TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood')),
 recipient TEXT NOT NULL, amount_micro TEXT NOT NULL,
 block_time TEXT NOT NULL, block_id TEXT NOT NULL,
 source_path TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(network,transaction_id)
) STRICT;
INSERT INTO payment_direct_transfers (network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at)
SELECT network,transaction_id,project_id,contribution_month,github_user_id,github_node_id,github_login,chain,recipient,amount_micro,block_time,block_id,source_path,imported_at FROM payment_direct_transfers_0017_copy;
DROP TABLE payment_direct_transfers_0017_copy;
CREATE INDEX payment_direct_actor ON payment_direct_transfers(github_user_id);
CREATE INDEX payment_direct_project ON payment_direct_transfers(project_id,contribution_month);
CREATE TRIGGER payment_direct_conflict BEFORE INSERT ON payment_direct_transfers
WHEN EXISTS(SELECT 1 FROM payment_direct_transfers o WHERE o.network=NEW.network
 AND o.transaction_id=NEW.transaction_id AND (o.project_id!=NEW.project_id
 OR o.contribution_month!=NEW.contribution_month OR o.github_user_id!=NEW.github_user_id
 OR o.github_node_id!=NEW.github_node_id OR o.chain!=NEW.chain
 OR o.recipient!=NEW.recipient OR o.amount_micro!=NEW.amount_micro
 OR o.block_time!=NEW.block_time OR o.block_id!=NEW.block_id))
BEGIN SELECT RAISE(ABORT,'direct transfer contradicts imported record'); END;
CREATE TRIGGER payment_direct_no_update BEFORE UPDATE ON payment_direct_transfers
WHEN NEW.network!=OLD.network OR NEW.transaction_id!=OLD.transaction_id
 OR NEW.project_id!=OLD.project_id OR NEW.contribution_month!=OLD.contribution_month
 OR NEW.github_user_id!=OLD.github_user_id OR NEW.github_node_id!=OLD.github_node_id
 OR NEW.chain!=OLD.chain OR NEW.recipient!=OLD.recipient
 OR NEW.amount_micro!=OLD.amount_micro OR NEW.block_time!=OLD.block_time
 OR NEW.block_id!=OLD.block_id
BEGIN SELECT RAISE(ABORT,'direct transfer immutable'); END;
CREATE TRIGGER payment_direct_no_delete BEFORE DELETE ON payment_direct_transfers
BEGIN SELECT RAISE(ABORT,'direct transfer permanent'); END;

-- wallet_observations (0015)
CREATE TABLE wallet_observations_0017_copy (
 github_user_id TEXT, github_node_id TEXT, github_login TEXT, chain TEXT,
 address TEXT, proof_level TEXT, source_url TEXT, source_commit TEXT,
 observed_at TEXT, record_path TEXT, imported_at TEXT
) STRICT;
INSERT INTO wallet_observations_0017_copy (github_user_id,github_node_id,github_login,chain,address,proof_level,source_url,source_commit,observed_at,record_path,imported_at)
SELECT github_user_id,github_node_id,github_login,chain,address,proof_level,source_url,source_commit,observed_at,record_path,imported_at FROM wallet_observations;
DROP TRIGGER wallet_observations_no_update;
DROP TRIGGER wallet_observations_no_delete;
DROP TABLE wallet_observations;
CREATE TABLE wallet_observations (
 github_user_id TEXT NOT NULL, github_node_id TEXT NOT NULL,
 github_login TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('base','solana','robinhood')),
 address TEXT NOT NULL,
 proof_level TEXT NOT NULL CHECK(proof_level IN ('profile_readme')),
 source_url TEXT NOT NULL, source_commit TEXT NOT NULL CHECK(length(source_commit)=40),
 observed_at TEXT NOT NULL, record_path TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(github_user_id,chain,address,source_commit)
) STRICT;
INSERT INTO wallet_observations (github_user_id,github_node_id,github_login,chain,address,proof_level,source_url,source_commit,observed_at,record_path,imported_at)
SELECT github_user_id,github_node_id,github_login,chain,address,proof_level,source_url,source_commit,observed_at,record_path,imported_at FROM wallet_observations_0017_copy;
DROP TABLE wallet_observations_0017_copy;
CREATE TRIGGER wallet_observations_no_update BEFORE UPDATE ON wallet_observations
WHEN NEW.github_user_id!=OLD.github_user_id OR NEW.github_node_id!=OLD.github_node_id
 OR NEW.chain!=OLD.chain OR NEW.address!=OLD.address OR NEW.proof_level!=OLD.proof_level
 OR NEW.source_url!=OLD.source_url OR NEW.source_commit!=OLD.source_commit
 OR NEW.observed_at!=OLD.observed_at
BEGIN SELECT RAISE(ABORT,'wallet observation immutable'); END;
CREATE TRIGGER wallet_observations_no_delete BEFORE DELETE ON wallet_observations
BEGIN SELECT RAISE(ABORT,'wallet observation permanent'); END;

PRAGMA foreign_keys = ON;

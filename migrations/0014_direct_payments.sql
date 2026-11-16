-- Transfers a project creator signed and broadcast outside escrow, imported
-- from the reviewed disclosures/*.json records on every deploy. They are not
-- escrow obligations and never become payment_obligations state 'paid'.
-- A transaction's facts are immutable. A disclosure that contradicts an
-- imported row fails the import; an identical row is a no-op.
CREATE TABLE payment_direct_transfers (
 network TEXT NOT NULL, transaction_id TEXT NOT NULL,
 project_id TEXT NOT NULL, contribution_month TEXT NOT NULL,
 github_user_id TEXT NOT NULL, github_node_id TEXT NOT NULL,
 github_login TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('base','solana')),
 recipient TEXT NOT NULL, amount_micro TEXT NOT NULL,
 block_time TEXT NOT NULL, block_id TEXT NOT NULL,
 source_path TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(network,transaction_id)
) STRICT;
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

-- Payment state is a projection of finalized chain events, not payment authority.
CREATE TABLE payment_obligations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, github_user_id TEXT NOT NULL,
 network TEXT NOT NULL, chain TEXT NOT NULL CHECK(chain IN ('base','solana')),
 vault TEXT NOT NULL, gross_micro TEXT NOT NULL, fee_micro TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 state TEXT NOT NULL CHECK(state IN ('reserved','paid')),
 created_at TEXT NOT NULL, paid_transaction TEXT
) STRICT;
CREATE INDEX payment_actor ON payment_obligations(github_user_id,chain,state);
CREATE TABLE payment_events (
 network TEXT NOT NULL, transaction_id TEXT NOT NULL, event_index INTEGER NOT NULL,
 block_id TEXT NOT NULL, kind TEXT NOT NULL, obligation_id TEXT NOT NULL,
 evidence_json TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(network,transaction_id,event_index)
) STRICT;
CREATE TRIGGER payment_events_no_update BEFORE UPDATE ON payment_events BEGIN SELECT RAISE(ABORT,'payment evidence immutable'); END;
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON payment_events BEGIN SELECT RAISE(ABORT,'payment evidence permanent'); END;
CREATE TABLE payment_wallet_authorizations (
 claim_id TEXT PRIMARY KEY REFERENCES wallet_claims(id), github_user_id TEXT NOT NULL,
 authorized_at TEXT NOT NULL, challenge_id TEXT NOT NULL REFERENCES payment_wallet_challenges(id),
 signature TEXT NOT NULL
) STRICT;
CREATE TABLE payment_outbox (
 obligation_id TEXT PRIMARY KEY REFERENCES payment_obligations(id),
 state TEXT NOT NULL CHECK(state IN ('ready','processing','submitted','paid','held')),
 lease_token TEXT, lease_until TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE payment_attempts (
 id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL REFERENCES payment_obligations(id),
 claim_id TEXT NOT NULL REFERENCES wallet_claims(id), created_at TEXT NOT NULL,
 transaction_id TEXT, state TEXT NOT NULL CHECK(state IN ('prepared','submitted','finalized','unknown','failed')),
 UNIQUE(obligation_id,transaction_id)
) STRICT;
CREATE TABLE payment_wallet_proposals (
 id TEXT PRIMARY KEY, github_user_id TEXT NOT NULL, chain TEXT NOT NULL CHECK(chain IN ('base','solana')),
 address TEXT NOT NULL, operator_id TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER payment_proposals_no_update BEFORE UPDATE ON payment_wallet_proposals BEGIN SELECT RAISE(ABORT,'wallet proposals immutable'); END;
CREATE TRIGGER payment_proposals_no_delete BEFORE DELETE ON payment_wallet_proposals BEGIN SELECT RAISE(ABORT,'wallet proposals permanent'); END;
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
CREATE TABLE payment_wallet_challenges (
 id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES wallet_claims(id),
 github_user_id TEXT NOT NULL, message TEXT NOT NULL, expires_at TEXT NOT NULL,
 consumed_at TEXT
) STRICT;
CREATE UNIQUE INDEX payment_event_once ON payment_events(obligation_id,kind);
CREATE TRIGGER payment_wallet_authorizations_no_update BEFORE UPDATE ON payment_wallet_authorizations
BEGIN SELECT RAISE(ABORT,'wallet authorization immutable'); END;
CREATE TRIGGER payment_wallet_authorizations_no_delete BEFORE DELETE ON payment_wallet_authorizations
BEGIN SELECT RAISE(ABORT,'wallet authorization evidence permanent'); END;
CREATE TRIGGER payment_wallet_challenges_consume_once BEFORE UPDATE ON payment_wallet_challenges
WHEN NEW.id!=OLD.id OR NEW.claim_id!=OLD.claim_id OR NEW.github_user_id!=OLD.github_user_id
 OR NEW.message!=OLD.message OR NEW.expires_at!=OLD.expires_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT,'wallet challenge may only be consumed once'); END;
CREATE TABLE payment_chain_cursors (
 project_id TEXT NOT NULL, network TEXT NOT NULL, position TEXT NOT NULL, synced_at TEXT NOT NULL,
 PRIMARY KEY(project_id,network)
) STRICT;
CREATE TABLE payment_attempt_failures (
 attempt_id TEXT PRIMARY KEY REFERENCES payment_attempts(id),
 transaction_id TEXT, observed_at TEXT NOT NULL, evidence_json TEXT NOT NULL
) STRICT;
CREATE TRIGGER payment_attempt_failures_no_update BEFORE UPDATE ON payment_attempt_failures
BEGIN SELECT RAISE(ABORT,'attempt failure evidence immutable'); END;
CREATE TRIGGER payment_attempt_failures_no_delete BEFORE DELETE ON payment_attempt_failures
BEGIN SELECT RAISE(ABORT,'attempt failure evidence permanent'); END;

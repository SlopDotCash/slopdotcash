-- Legacy wallet observations from GitHub profile READMEs, imported from the
-- reviewed preparations and cycle proposals on every deploy (PRD WAL-01).
-- They are historical evidence with their original proof level: a public
-- README at an immutable commit, with no wallet signature. They never become
-- wallet_claims, payment authorizations, or payout destinations.
CREATE TABLE wallet_observations (
 github_user_id TEXT NOT NULL, github_node_id TEXT NOT NULL,
 github_login TEXT NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('base','solana')),
 address TEXT NOT NULL,
 proof_level TEXT NOT NULL CHECK(proof_level IN ('profile_readme')),
 source_url TEXT NOT NULL, source_commit TEXT NOT NULL CHECK(length(source_commit)=40),
 observed_at TEXT NOT NULL, record_path TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(github_user_id,chain,address,source_commit)
) STRICT;
CREATE TRIGGER wallet_observations_no_update BEFORE UPDATE ON wallet_observations
WHEN NEW.github_user_id!=OLD.github_user_id OR NEW.github_node_id!=OLD.github_node_id
 OR NEW.chain!=OLD.chain OR NEW.address!=OLD.address OR NEW.proof_level!=OLD.proof_level
 OR NEW.source_url!=OLD.source_url OR NEW.source_commit!=OLD.source_commit
 OR NEW.observed_at!=OLD.observed_at
BEGIN SELECT RAISE(ABORT,'wallet observation immutable'); END;
CREATE TRIGGER wallet_observations_no_delete BEFORE DELETE ON wallet_observations
BEGIN SELECT RAISE(ABORT,'wallet observation permanent'); END;

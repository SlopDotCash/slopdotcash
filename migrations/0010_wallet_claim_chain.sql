-- Let a contributor hold one wallet claim lineage per settlement network.
-- Every existing claim is Solana. Rows stay immutable: adding a column with a
-- constant default rewrites no row, so the update and delete guards hold.

ALTER TABLE wallet_claims
ADD COLUMN chain TEXT NOT NULL DEFAULT 'solana'
CHECK (chain IN ('solana', 'base'));

DROP INDEX wallet_claims_one_root_per_actor;

-- One root per actor per chain. The one-successor index is unchanged, so each
-- lineage still has exactly one tip and forks fail at the database boundary.
CREATE UNIQUE INDEX wallet_claims_one_root_per_actor
ON wallet_claims(github_user_id, chain)
WHERE supersedes_claim_id IS NULL;

DROP INDEX wallet_claims_actor;

CREATE INDEX wallet_claims_actor
ON wallet_claims(github_user_id, chain, observed_at);

-- A successor must stay on its predecessor's chain, so a Base claim can never
-- retire a Solana address or the reverse.
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

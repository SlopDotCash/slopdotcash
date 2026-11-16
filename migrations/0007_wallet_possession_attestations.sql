-- Records that the holder of a claimed Solana destination key signed a
-- server-issued challenge bound to one wallet claim. Possession is additive
-- evidence: an existing claim without an attestation stays exactly as valid as
-- it is today, and no payout state is derived from this table.

-- Ephemeral single-use nonces. A challenge is consumable state rather than a
-- permanent record, so it is the one wallet table that accepts an update.
CREATE TABLE wallet_possession_challenges (
  challenge_id TEXT PRIMARY KEY CHECK (length(challenge_id) = 32),
  claim_id TEXT NOT NULL REFERENCES wallet_claims(id),
  github_user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX wallet_possession_challenges_claim
ON wallet_possession_challenges(claim_id, issued_at);

CREATE INDEX wallet_possession_challenges_expiry
ON wallet_possession_challenges(expires_at)
WHERE consumed_at IS NULL;

-- One permanent attestation per claim. A contributor who changes destination
-- appends a successor claim and proves that one; history is never edited.
CREATE TABLE wallet_possession_attestations (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE REFERENCES wallet_claims(id),
  challenge_id TEXT NOT NULL UNIQUE REFERENCES wallet_possession_challenges(challenge_id),
  github_user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  signature TEXT NOT NULL CHECK (length(signature) = 88),
  message_sha256 TEXT NOT NULL CHECK (length(message_sha256) = 64),
  attested_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX wallet_possession_attestations_actor
ON wallet_possession_attestations(github_user_id, attested_at);

CREATE TRIGGER wallet_possession_attestations_no_update
BEFORE UPDATE ON wallet_possession_attestations
BEGIN
  SELECT RAISE(ABORT, 'wallet possession attestations are immutable');
END;

CREATE TRIGGER wallet_possession_attestations_no_delete
BEFORE DELETE ON wallet_possession_attestations
BEGIN
  SELECT RAISE(ABORT, 'wallet possession attestations are permanent');
END;

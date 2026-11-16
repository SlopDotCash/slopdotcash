-- A Base destination binding needs the destination wallet's own EIP-712
-- signature over the chain, vault, actor, destination, expected version,
-- claim digest and expiry. The contributor signs it in their wallet; the
-- identity attester submits it unchanged. Rows are append-only evidence: a
-- signature with a new expiry for the same claim, deployment and version is a
-- new row, so an expired authorization never blocks a renewal. The attester
-- uses the usable row with the latest expiry.
CREATE TABLE payment_binding_authorizations (
 claim_id TEXT NOT NULL REFERENCES wallet_claims(id), github_user_id TEXT NOT NULL,
 network TEXT NOT NULL, vault TEXT NOT NULL, chain_id TEXT NOT NULL,
 expected_version TEXT NOT NULL, expires_at TEXT NOT NULL, signature TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(claim_id, network, vault, chain_id, expected_version, expires_at)
) STRICT;
CREATE TRIGGER payment_binding_authorizations_no_update BEFORE UPDATE ON payment_binding_authorizations
BEGIN SELECT RAISE(ABORT,'binding authorization immutable'); END;
CREATE TRIGGER payment_binding_authorizations_no_delete BEFORE DELETE ON payment_binding_authorizations
BEGIN SELECT RAISE(ABORT,'binding authorization evidence permanent'); END;

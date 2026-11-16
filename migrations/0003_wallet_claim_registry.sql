-- Make the authenticated append-only D1 registry the canonical wallet source.
-- Historical issue and profile observations remain valid immutable records,
-- but new contributor claims are written directly after GitHub OAuth.

DROP TRIGGER wallet_claims_no_update;
DROP TRIGGER wallet_claims_no_delete;
DROP INDEX wallet_claims_actor;

ALTER TABLE wallet_claims RENAME TO wallet_claims_legacy;

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
  record_sha256, supersedes_claim_id, created_at
)
SELECT
  id, github_user_id, github_login, wallet_address,
  CASE source WHEN 'd1_fallback' THEN 'd1_registry' ELSE source END,
  issue_repository, issue_number, source_body_sha256, observed_at,
  record_sha256, supersedes_claim_id, created_at
FROM wallet_claims_legacy;

DROP TABLE wallet_claims_legacy;

CREATE INDEX wallet_claims_actor
ON wallet_claims(github_user_id, observed_at);

-- A contributor has one claim lineage. Every change extends its current tip;
-- forks and competing roots fail at the database boundary under concurrency.
CREATE UNIQUE INDEX wallet_claims_one_root_per_actor
ON wallet_claims(github_user_id)
WHERE supersedes_claim_id IS NULL;

CREATE UNIQUE INDEX wallet_claims_one_successor
ON wallet_claims(supersedes_claim_id)
WHERE supersedes_claim_id IS NOT NULL;

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

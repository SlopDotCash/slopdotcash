-- Registration records intent. Only wallet authorization replaces an active
-- payout destination. This view derives state from the original immutable
-- claims and authorizations; it stores no second wallet inventory.
CREATE VIEW effective_payment_wallet_claims AS
SELECT w.* FROM wallet_claims w
WHERE (
  EXISTS (SELECT 1 FROM payment_wallet_authorizations a
          WHERE a.claim_id=w.id AND a.github_user_id=w.github_user_id)
  AND NOT EXISTS (
    WITH RECURSIVE successors(id) AS (
      SELECT n.id FROM wallet_claims n WHERE n.supersedes_claim_id=w.id
        AND n.github_user_id=w.github_user_id AND n.chain=w.chain
      UNION
      SELECT n.id FROM wallet_claims n JOIN successors s ON n.supersedes_claim_id=s.id
        WHERE n.github_user_id=w.github_user_id AND n.chain=w.chain
    )
    SELECT 1 FROM successors s JOIN payment_wallet_authorizations a ON a.claim_id=s.id
      WHERE a.github_user_id=w.github_user_id
  )
) OR (
  NOT EXISTS (SELECT 1 FROM wallet_claims p JOIN payment_wallet_authorizations a
              ON a.claim_id=p.id AND a.github_user_id=p.github_user_id
              WHERE p.github_user_id=w.github_user_id AND p.chain=w.chain)
  AND NOT EXISTS (SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)
);

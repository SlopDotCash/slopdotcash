-- Running reviews must remain recoverable after a terminated queue invocation.
ALTER TABLE slopbot_reviews ADD COLUMN claim_token TEXT;
ALTER TABLE slopbot_reviews ADD COLUMN lease_expires_at TEXT;
UPDATE slopbot_reviews
SET claim_token = 'legacy:' || review_key,
    lease_expires_at = COALESCE(
      strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+20 minutes'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+20 minutes')
    )
WHERE status = 'running';

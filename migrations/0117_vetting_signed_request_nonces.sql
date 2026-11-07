-- Signed private sandbox requests are at-most-once within and beyond the
-- signature window. Retention is permanent so an old nonce cannot re-enter.
CREATE TABLE vetting_signed_request_nonces (
  signing_key_sha256 TEXT NOT NULL CHECK(length(signing_key_sha256)=64),
  nonce TEXT NOT NULL CHECK(length(nonce)=32 AND nonce NOT GLOB '*[^0-9a-f]*'),
  consumed_at TEXT NOT NULL,
  PRIMARY KEY(signing_key_sha256,nonce)
) STRICT;
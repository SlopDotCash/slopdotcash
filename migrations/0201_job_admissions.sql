CREATE TABLE job_admissions (
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  job_key TEXT NOT NULL CHECK (length(job_key) BETWEEN 1 AND 200),
  network TEXT NOT NULL CHECK (network IN ('', 'Base', 'Ethereum', 'Robinhood', 'Solana')),
  lease_id TEXT NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 200),
  expires_at TEXT NOT NULL CHECK (length(expires_at) = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) = expires_at),
  PRIMARY KEY (kind, job_key, network)
) STRICT;

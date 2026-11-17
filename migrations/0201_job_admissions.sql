CREATE TABLE job_admissions (
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  job_key TEXT NOT NULL CHECK (length(job_key) BETWEEN 1 AND 200),
  network TEXT NOT NULL CHECK (network IN ('', 'Base', 'Ethereum', 'Robinhood', 'Solana')),
  lease_id TEXT NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 200),
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (kind, job_key, network)
) STRICT;

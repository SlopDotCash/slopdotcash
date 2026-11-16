-- Durable backward discovery, then oldest-first indexing. The generation and
-- revision fence concurrent runs; pages are removed only with a verified cursor.
CREATE TABLE payment_solana_scans (
 project_id TEXT NOT NULL, network TEXT NOT NULL, generation TEXT NOT NULL,
 until_signature TEXT, before_signature TEXT, next_page INTEGER NOT NULL DEFAULT 0,
 ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,network)
) STRICT;
CREATE TABLE payment_solana_scan_pages (
 project_id TEXT NOT NULL, network TEXT NOT NULL, generation TEXT NOT NULL,
 page INTEGER NOT NULL, signatures_json TEXT NOT NULL,
 PRIMARY KEY(project_id,network,generation,page)
) STRICT;

-- A vault creation its owner asked to register before the chain had
-- finalized it (operator decision, 17 November 2026; PRD section 6). The
-- registration check used to run only from the owner's page, so a vault whose
-- owner left before finality stayed unrecorded. The server keeps the owner's
-- exact request here and repeats it as the same account, with every check of
-- the ordinary route, until it registers, the creation is refused, or two
-- days pass. Nothing here registers a vault by itself.
CREATE TABLE saved_vault_creations (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 network TEXT NOT NULL,
 transaction_id TEXT NOT NULL,
 request_json TEXT NOT NULL,
 actor_github_id TEXT NOT NULL,
 actor_github_login TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('waiting','registered','refused','expired')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 last_code TEXT,
 created_at TEXT NOT NULL,
 finished_at TEXT,
 UNIQUE (project_id, network, transaction_id)
) STRICT;
CREATE INDEX saved_vault_creations_due ON saved_vault_creations(next_attempt_at)
 WHERE state = 'waiting';

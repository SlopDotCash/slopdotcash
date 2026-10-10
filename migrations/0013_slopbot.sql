-- Slopbot v2 (draft, docs/slopbot-v2-proposal.md). Append-only operational
-- state for the hosted GitHub App. Money values are integer micro-units.
CREATE TABLE slopbot_installations (
 installation_id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, account_login TEXT NOT NULL,
 account_type TEXT NOT NULL CHECK(account_type IN ('User','Organization')),
 created_at TEXT NOT NULL, suspended_at TEXT, removed_at TEXT
) STRICT;
CREATE TABLE slopbot_deliveries (
 delivery_id TEXT PRIMARY KEY, event TEXT NOT NULL, received_at TEXT NOT NULL
) STRICT;
CREATE TABLE slopbot_reviews (
 review_key TEXT PRIMARY KEY, installation_id INTEGER NOT NULL, repository_id INTEGER NOT NULL,
 item_kind TEXT NOT NULL CHECK(item_kind IN ('issue','pull_request')), item_number INTEGER NOT NULL,
 item_node_id TEXT NOT NULL, author_id INTEGER NOT NULL, revision TEXT NOT NULL, content_digest TEXT NOT NULL,
 policy_digest TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed','skipped')),
 skip_reason TEXT, verdict TEXT CHECK(verdict IS NULL OR json_valid(verdict)), action TEXT,
 created_at TEXT NOT NULL, completed_at TEXT
) STRICT;
CREATE INDEX slopbot_reviews_author ON slopbot_reviews(repository_id, author_id, created_at);
CREATE INDEX slopbot_reviews_digest ON slopbot_reviews(repository_id, author_id, content_digest);
CREATE TABLE slopbot_costs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, review_key TEXT NOT NULL, installation_id INTEGER NOT NULL,
 call_kind TEXT NOT NULL CHECK(call_kind IN ('triage','confirm')), route_step INTEGER NOT NULL,
 provider TEXT NOT NULL, requested_model TEXT NOT NULL, served_model TEXT,
 outcome TEXT NOT NULL CHECK(outcome IN ('ok','failed')), failure TEXT,
 input_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
 output_tokens INTEGER NOT NULL, price_version TEXT NOT NULL, cost_micro_usd INTEGER NOT NULL,
 billed_micro_usdc INTEGER NOT NULL, reconciliation TEXT NOT NULL CHECK(reconciliation IN ('list-price','estimated','reconciled')),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX slopbot_costs_installation ON slopbot_costs(installation_id, created_at);
CREATE TABLE slopbot_credits (
 id INTEGER PRIMARY KEY AUTOINCREMENT, installation_id INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('allowance','deposit','refund')), amount_micro_usdc INTEGER NOT NULL,
 reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE slopbot_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, review_key TEXT NOT NULL, repository_id INTEGER NOT NULL,
 item_node_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('comment','label','close','appeal','human_reopen')),
 detail TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(review_key, action)
) STRICT;
CREATE INDEX slopbot_actions_repo ON slopbot_actions(repository_id, action, created_at);
CREATE TABLE slopbot_item_comments (
 item_node_id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, comment_id INTEGER NOT NULL
) STRICT;
CREATE TRIGGER slopbot_costs_immutable BEFORE UPDATE ON slopbot_costs
WHEN NEW.cost_micro_usd != OLD.cost_micro_usd OR NEW.billed_micro_usdc != OLD.billed_micro_usdc OR NEW.review_key != OLD.review_key
BEGIN SELECT RAISE(ABORT, 'slopbot cost rows are immutable'); END;
CREATE TRIGGER slopbot_costs_no_delete BEFORE DELETE ON slopbot_costs
BEGIN SELECT RAISE(ABORT, 'slopbot cost rows are append-only'); END;
CREATE TRIGGER slopbot_credits_no_change BEFORE UPDATE ON slopbot_credits
BEGIN SELECT RAISE(ABORT, 'slopbot credits are append-only'); END;

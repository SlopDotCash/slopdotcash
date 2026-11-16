-- BOT-07 rounds the markup once per review, including confirmation.
-- Preserve old call-level amounts; do not reinterpret or rewrite old invoices.
ALTER TABLE slopbot_costs ADD COLUMN billing_rule TEXT NOT NULL DEFAULT 'call-v1'
 CHECK(billing_rule IN ('call-v1','review-v2'));
ALTER TABLE slopbot_costs ADD COLUMN billable_cost_micro_usd INTEGER NOT NULL DEFAULT 0
 CHECK(billable_cost_micro_usd >= 0);

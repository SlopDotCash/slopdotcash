-- A failed provider attempt and an item blocked until a budget reset are
-- different states. Preserve the block and its identifier-only retry job.
CREATE TABLE slopbot_budget_blocks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 review_key TEXT NOT NULL,
 claim_token TEXT NOT NULL,
 job_json TEXT NOT NULL CHECK(json_valid(job_json)),
 blocked_at TEXT NOT NULL,
 retry_at TEXT NOT NULL,
 UNIQUE(review_key, claim_token)
) STRICT;
CREATE TABLE slopbot_budget_dispatches (
 block_id INTEGER PRIMARY KEY REFERENCES slopbot_budget_blocks(id),
 queued_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER slopbot_budget_block_claim BEFORE INSERT ON slopbot_budget_blocks
WHEN NOT EXISTS (
 SELECT 1 FROM slopbot_reviews r WHERE r.review_key=NEW.review_key
 AND r.claim_token=NEW.claim_token AND r.status='running'
 AND r.lease_expires_at>NEW.blocked_at
 AND r.installation_id=json_extract(NEW.job_json,'$.installationId')
 AND r.repository_id=json_extract(NEW.job_json,'$.repositoryId')
 AND r.item_number=json_extract(NEW.job_json,'$.number')
 AND r.item_kind=json_extract(NEW.job_json,'$.itemKind')
)
BEGIN SELECT RAISE(ABORT,'budget block lost its review claim'); END;
CREATE TRIGGER slopbot_budget_block_finish AFTER INSERT ON slopbot_budget_blocks
BEGIN
 UPDATE slopbot_reviews SET status='failed', skip_reason='blocked: provider budget exhausted',
 completed_at=NEW.blocked_at, lease_expires_at=NULL
 WHERE review_key=NEW.review_key AND claim_token=NEW.claim_token;
END;
CREATE TRIGGER slopbot_budget_blocks_no_update BEFORE UPDATE ON slopbot_budget_blocks
BEGIN SELECT RAISE(ABORT,'budget blocks are immutable'); END;
CREATE TRIGGER slopbot_budget_blocks_no_delete BEFORE DELETE ON slopbot_budget_blocks
BEGIN SELECT RAISE(ABORT,'budget blocks are immutable'); END;
CREATE TRIGGER slopbot_budget_blocks_no_replace BEFORE INSERT ON slopbot_budget_blocks
WHEN EXISTS(SELECT 1 FROM slopbot_budget_blocks
 WHERE id=NEW.id OR (review_key=NEW.review_key AND claim_token=NEW.claim_token))
BEGIN SELECT RAISE(ABORT,'budget blocks cannot be replaced'); END;
CREATE TRIGGER slopbot_budget_dispatches_no_update BEFORE UPDATE ON slopbot_budget_dispatches
BEGIN SELECT RAISE(ABORT,'budget dispatches are immutable'); END;
CREATE TRIGGER slopbot_budget_dispatches_no_delete BEFORE DELETE ON slopbot_budget_dispatches
BEGIN SELECT RAISE(ABORT,'budget dispatches are immutable'); END;
CREATE TRIGGER slopbot_budget_dispatches_no_replace BEFORE INSERT ON slopbot_budget_dispatches
WHEN EXISTS(SELECT 1 FROM slopbot_budget_dispatches WHERE block_id=NEW.block_id)
BEGIN SELECT RAISE(ABORT,'budget dispatches cannot be replaced'); END;

-- Public reasons for owner cuts (PRD section 6, operator decision,
-- 15 November 2026). A change that sets a contributor's gross below the
-- proposed amount of that month is a cut. Each cut carries the owner's written
-- reason, is public on the cycle page and reaches the contributor's Inbox.
-- Increases and changes at or above the proposal carry no row here.
--
-- One row per cut change, keyed like the change it explains. The proposed and
-- new amounts are copied from the proposal row and the change row at write
-- time. Rows are append-only: a later raise is a new change, and the public
-- list shows only each contributor's latest change.

CREATE TABLE monthly_allocation_cut_reasons (
 project_id TEXT NOT NULL,
 period TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence > 0),
 github_user_id TEXT NOT NULL CHECK(length(github_user_id) BETWEEN 1 AND 20 AND github_user_id NOT GLOB '*[^0-9]*' AND github_user_id NOT GLOB '0*'),
 proposed_gross_base TEXT NOT NULL CHECK(length(proposed_gross_base) BETWEEN 1 AND 39 AND proposed_gross_base NOT GLOB '*[^0-9]*'),
 gross_base TEXT NOT NULL CHECK(length(gross_base) BETWEEN 1 AND 39 AND gross_base NOT GLOB '*[^0-9]*'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 500 AND reason = trim(reason)),
 actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 20 AND actor_id NOT GLOB '*[^0-9]*'),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period,sequence),
 FOREIGN KEY(project_id,period,sequence) REFERENCES monthly_allocation_changes(project_id,period,sequence)
) STRICT;
CREATE INDEX monthly_allocation_cut_reasons_month
 ON monthly_allocation_cut_reasons(project_id,period,created_at);
CREATE TRIGGER monthly_allocation_cut_reasons_no_update BEFORE UPDATE ON monthly_allocation_cut_reasons
BEGIN SELECT RAISE(ABORT,'allocation cut record immutable'); END;
CREATE TRIGGER monthly_allocation_cut_reasons_no_delete BEFORE DELETE ON monthly_allocation_cut_reasons
BEGIN SELECT RAISE(ABORT,'allocation cut record permanent'); END;

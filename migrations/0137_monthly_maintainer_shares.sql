-- Maintainer share of a monthly allocation (operator decision, 18 November
-- 2026; PRD section 6).
--
-- A project owner may set a share of the monthly amount, up to 30%, for the
-- accounts that decide outside pull requests. The trusted monthly workflow
-- reads from GitHub who merged or closed each outside pull request in the
-- closed UTC month and takes the share out of the monthly amount before the
-- points split. The proposed rows in monthly_reward_base_rows already contain
-- each account's part of the share; these two tables keep the record the
-- split was computed from.
--
-- monthly_maintainer_shares: one row per proposed project month that had a
-- maintainer share, with the exact decision record and its digest.
-- monthly_maintainer_share_rows: the part of the share of each deciding
-- account. An account with both a points share and a part of the maintainer
-- share has one proposed row whose amount is their sum.
-- Like the proposal, both are written once and never change.

CREATE TABLE monthly_maintainer_shares (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 basis_points INTEGER NOT NULL CHECK(basis_points BETWEEN 1 AND 3000),
 pool_base TEXT NOT NULL CHECK(length(pool_base) BETWEEN 1 AND 39 AND pool_base NOT GLOB '*[^0-9]*'),
 decisions TEXT NOT NULL CHECK(json_valid(decisions)),
 decisions_sha256 TEXT NOT NULL CHECK(length(decisions_sha256)=64 AND decisions_sha256 NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period),
 FOREIGN KEY(project_id,period) REFERENCES monthly_reward_bases(project_id,period)
) STRICT;
CREATE TRIGGER monthly_maintainer_shares_no_update BEFORE UPDATE ON monthly_maintainer_shares
BEGIN SELECT RAISE(ABORT,'monthly maintainer share immutable'); END;
CREATE TRIGGER monthly_maintainer_shares_no_delete BEFORE DELETE ON monthly_maintainer_shares
BEGIN SELECT RAISE(ABORT,'monthly maintainer share permanent'); END;

CREATE TABLE monthly_maintainer_share_rows (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 github_user_id TEXT NOT NULL CHECK(length(github_user_id) BETWEEN 1 AND 20 AND github_user_id NOT GLOB '*[^0-9]*' AND github_user_id NOT GLOB '0*'),
 github_login TEXT NOT NULL CHECK(length(github_login) BETWEEN 1 AND 39),
 decisions INTEGER NOT NULL CHECK(decisions > 0),
 gross_base TEXT NOT NULL CHECK(length(gross_base) BETWEEN 1 AND 39 AND gross_base NOT GLOB '*[^0-9]*'),
 PRIMARY KEY(project_id,period,github_user_id),
 FOREIGN KEY(project_id,period) REFERENCES monthly_maintainer_shares(project_id,period),
 FOREIGN KEY(project_id,period,github_user_id) REFERENCES monthly_reward_base_rows(project_id,period,github_user_id)
) STRICT;
CREATE TRIGGER monthly_maintainer_share_rows_no_update BEFORE UPDATE ON monthly_maintainer_share_rows
BEGIN SELECT RAISE(ABORT,'monthly maintainer share immutable'); END;
CREATE TRIGGER monthly_maintainer_share_rows_no_delete BEFORE DELETE ON monthly_maintainer_share_rows
BEGIN SELECT RAISE(ABORT,'monthly maintainer share permanent'); END;

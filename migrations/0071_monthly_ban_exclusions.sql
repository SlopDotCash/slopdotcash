-- An unfunded award is excluded when its recipient has an active account ban.
-- Keep the original frozen snapshot and the exact ban decision as evidence.
CREATE TABLE monthly_payment_exclusions (
 project_id TEXT NOT NULL, period TEXT NOT NULL, github_user_id TEXT NOT NULL,
 network TEXT NOT NULL, vault TEXT NOT NULL, source_digest TEXT NOT NULL,
 enforcement_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period,github_user_id),
 UNIQUE(network,vault,source_digest),
 FOREIGN KEY(project_id,period) REFERENCES monthly_payment_runs(project_id,period),
 FOREIGN KEY(enforcement_id,github_user_id) REFERENCES project_maintainer_bans(enforcement_id,github_id)
) STRICT;
CREATE TRIGGER monthly_payment_exclusions_no_update BEFORE UPDATE ON monthly_payment_exclusions
BEGIN SELECT RAISE(ABORT,'monthly exclusion immutable'); END;
CREATE TRIGGER monthly_payment_exclusions_no_delete BEFORE DELETE ON monthly_payment_exclusions
BEGIN SELECT RAISE(ABORT,'monthly exclusion permanent'); END;

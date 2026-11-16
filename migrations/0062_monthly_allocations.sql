-- Private monthly allocations and the automatic monthly coordinator (PRD
-- section 6 and section 7: owners change proposed amounts privately; the
-- automatic monthly process distributes the current allocations at the
-- cutoff; no public adjustment history or reasons).
--
-- monthly_reward_bases: the proposed allocation of one closed UTC month,
-- computed once from the complete ledger by the trusted monthly workflow.
-- monthly_allocation_changes: the owner's private edits, append-only. They are
-- internal records for dispute handling and reconciliation and are never
-- published. The newest row per recipient is the current allocation.
-- monthly_payment_settings: the owner's switch for the automatic default.
-- monthly_payment_runs: the frozen execution snapshot, one per project month.
-- monthly_payment_obligations: one award per recipient, created once from the
-- frozen snapshot when the vault's free balance covers it. The owner's wallet
-- reserves each on chain under the same source digest, so a manual and an
-- automatic path can never reserve the same award twice.
-- Amounts are base-unit integer text of the project asset (uint64 at most).

CREATE TABLE monthly_reward_bases (
 project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 64 AND project_id NOT GLOB '*[^a-z0-9-]*'),
 period TEXT NOT NULL CHECK(length(period)=7 AND period GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
 manifest TEXT NOT NULL,
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64 AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
 cap_base TEXT NOT NULL CHECK(length(cap_base) BETWEEN 1 AND 20 AND cap_base NOT GLOB '*[^0-9]*'),
 recipient_count INTEGER NOT NULL CHECK(recipient_count >= 0),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period)
) STRICT;
CREATE TRIGGER monthly_reward_bases_no_update BEFORE UPDATE ON monthly_reward_bases
BEGIN SELECT RAISE(ABORT,'monthly base immutable'); END;
CREATE TRIGGER monthly_reward_bases_no_delete BEFORE DELETE ON monthly_reward_bases
BEGIN SELECT RAISE(ABORT,'monthly base permanent'); END;

CREATE TABLE monthly_reward_base_rows (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 github_user_id TEXT NOT NULL CHECK(length(github_user_id) BETWEEN 1 AND 20 AND github_user_id NOT GLOB '*[^0-9]*' AND github_user_id NOT GLOB '0*'),
 github_login TEXT NOT NULL CHECK(length(github_login) BETWEEN 1 AND 39),
 gross_base TEXT NOT NULL CHECK(length(gross_base) BETWEEN 1 AND 20 AND gross_base NOT GLOB '*[^0-9]*'),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(project_id,period,github_user_id),
 FOREIGN KEY(project_id,period) REFERENCES monthly_reward_bases(project_id,period)
) STRICT;
CREATE TRIGGER monthly_reward_base_rows_no_update BEFORE UPDATE ON monthly_reward_base_rows
BEGIN SELECT RAISE(ABORT,'monthly base immutable'); END;
CREATE TRIGGER monthly_reward_base_rows_no_delete BEFORE DELETE ON monthly_reward_base_rows
BEGIN SELECT RAISE(ABORT,'monthly base permanent'); END;

CREATE TABLE monthly_allocation_changes (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence > 0),
 github_user_id TEXT NOT NULL,
 gross_base TEXT NOT NULL CHECK(length(gross_base) BETWEEN 1 AND 20 AND gross_base NOT GLOB '*[^0-9]*'),
 actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 20 AND actor_id NOT GLOB '*[^0-9]*'),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period,sequence),
 FOREIGN KEY(project_id,period,github_user_id) REFERENCES monthly_reward_base_rows(project_id,period,github_user_id)
) STRICT;
CREATE TRIGGER monthly_allocation_changes_no_update BEFORE UPDATE ON monthly_allocation_changes
BEGIN SELECT RAISE(ABORT,'allocation change record immutable'); END;
CREATE TRIGGER monthly_allocation_changes_no_delete BEFORE DELETE ON monthly_allocation_changes
BEGIN SELECT RAISE(ABORT,'allocation change record permanent'); END;

CREATE TABLE monthly_payment_settings (
 project_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence > 0),
 automatic INTEGER NOT NULL CHECK(automatic IN (0,1)),
 actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 20 AND actor_id NOT GLOB '*[^0-9]*'),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,sequence)
) STRICT;
CREATE TRIGGER monthly_payment_settings_no_update BEFORE UPDATE ON monthly_payment_settings
BEGIN SELECT RAISE(ABORT,'monthly setting immutable'); END;
CREATE TRIGGER monthly_payment_settings_no_delete BEFORE DELETE ON monthly_payment_settings
BEGIN SELECT RAISE(ABORT,'monthly setting permanent'); END;

CREATE TABLE monthly_payment_runs (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 trigger TEXT NOT NULL CHECK(trigger IN ('owner','automatic')),
 actor_id TEXT CHECK(actor_id IS NULL OR (length(actor_id) BETWEEN 1 AND 20 AND actor_id NOT GLOB '*[^0-9]*')),
 allocation_sequence INTEGER NOT NULL CHECK(allocation_sequence >= 0),
 snapshot TEXT NOT NULL,
 snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
 network TEXT NOT NULL, vault TEXT NOT NULL,
 total_gross_base TEXT NOT NULL CHECK(length(total_gross_base) BETWEEN 1 AND 20 AND total_gross_base NOT GLOB '*[^0-9]*'),
 frozen_at TEXT NOT NULL,
 obligations_created_at TEXT,
 PRIMARY KEY(project_id,period),
 FOREIGN KEY(project_id,period) REFERENCES monthly_reward_bases(project_id,period),
 CHECK((trigger='owner') = (actor_id IS NOT NULL))
) STRICT;
CREATE TRIGGER monthly_payment_runs_frozen BEFORE UPDATE ON monthly_payment_runs
WHEN NEW.project_id!=OLD.project_id OR NEW.period!=OLD.period OR NEW.trigger!=OLD.trigger
 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.allocation_sequence!=OLD.allocation_sequence
 OR NEW.snapshot!=OLD.snapshot OR NEW.snapshot_sha256!=OLD.snapshot_sha256
 OR NEW.network!=OLD.network OR NEW.vault!=OLD.vault OR NEW.total_gross_base!=OLD.total_gross_base
 OR NEW.frozen_at!=OLD.frozen_at OR OLD.obligations_created_at IS NOT NULL OR NEW.obligations_created_at IS NULL
BEGIN SELECT RAISE(ABORT,'monthly execution snapshot frozen'); END;
CREATE TRIGGER monthly_payment_runs_no_delete BEFORE DELETE ON monthly_payment_runs
BEGIN SELECT RAISE(ABORT,'monthly execution snapshot permanent'); END;
-- A frozen month accepts no further allocation change.
CREATE TRIGGER monthly_allocation_changes_before_freeze BEFORE INSERT ON monthly_allocation_changes
WHEN EXISTS(SELECT 1 FROM monthly_payment_runs WHERE project_id=NEW.project_id AND period=NEW.period)
BEGIN SELECT RAISE(ABORT,'monthly allocations frozen'); END;

CREATE TABLE monthly_payment_obligations (
 project_id TEXT NOT NULL, period TEXT NOT NULL,
 github_user_id TEXT NOT NULL CHECK(length(github_user_id) BETWEEN 1 AND 20 AND github_user_id NOT GLOB '*[^0-9]*' AND github_user_id NOT GLOB '0*'),
 github_login TEXT NOT NULL,
 gross_base TEXT NOT NULL CHECK(length(gross_base) BETWEEN 1 AND 20 AND gross_base NOT GLOB '*[^0-9]*' AND gross_base NOT GLOB '0*'),
 fee_base TEXT NOT NULL CHECK(length(fee_base) BETWEEN 1 AND 20 AND fee_base NOT GLOB '*[^0-9]*'),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
 network TEXT NOT NULL, vault TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period,github_user_id),
 UNIQUE(network,vault,source_digest),
 FOREIGN KEY(project_id,period) REFERENCES monthly_payment_runs(project_id,period)
) STRICT;
CREATE TRIGGER monthly_payment_obligations_no_update BEFORE UPDATE ON monthly_payment_obligations
BEGIN SELECT RAISE(ABORT,'monthly obligation immutable'); END;
CREATE TRIGGER monthly_payment_obligations_no_delete BEFORE DELETE ON monthly_payment_obligations
BEGIN SELECT RAISE(ABORT,'monthly obligation permanent'); END;

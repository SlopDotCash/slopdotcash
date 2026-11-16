-- Final ordinary monthly authorizations are public execution inputs, not payment evidence.
CREATE TABLE monthly_payment_authorizations (
 project_id TEXT NOT NULL,
 period TEXT NOT NULL,
 network TEXT NOT NULL,
 snapshot_sha256 TEXT NOT NULL,
 authorization TEXT NOT NULL CHECK(json_valid(authorization)),
 published_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period,network),
 FOREIGN KEY(project_id,period) REFERENCES monthly_payment_runs(project_id,period)
) STRICT;
CREATE TRIGGER monthly_payment_authorizations_no_update BEFORE UPDATE ON monthly_payment_authorizations
BEGIN SELECT RAISE(ABORT,'monthly authorization immutable'); END;
CREATE TRIGGER monthly_payment_authorizations_no_delete BEFORE DELETE ON monthly_payment_authorizations
BEGIN SELECT RAISE(ABORT,'monthly authorization permanent'); END;

-- Internal retry cursor only. Public paid/reserved state still comes from finalized indexing.
CREATE TABLE monthly_payment_execution (
 project_id TEXT NOT NULL,
 period TEXT NOT NULL,
 network TEXT NOT NULL,
 last_attempt TEXT NOT NULL,
 complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
 PRIMARY KEY(project_id,period,network),
 FOREIGN KEY(project_id,period,network) REFERENCES monthly_payment_authorizations(project_id,period,network)
) STRICT;

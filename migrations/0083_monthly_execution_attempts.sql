-- Source consumption can invalidate an unadmitted EVM V2 signature. Retain
-- each replacement attempt beside the permanent first authorization.
CREATE TABLE monthly_payment_authorization_attempts (
 project_id TEXT NOT NULL,
 period TEXT NOT NULL,
 network TEXT NOT NULL,
 source_sequence TEXT NOT NULL CHECK(
   length(source_sequence) BETWEEN 1 AND 78 AND
   source_sequence NOT GLOB '*[^0-9]*' AND
   (source_sequence='0' OR substr(source_sequence,1,1)<>'0')
 ),
 authorization TEXT NOT NULL CHECK(json_valid(authorization)),
 published_at TEXT NOT NULL,
 PRIMARY KEY(project_id,period,network,source_sequence),
 FOREIGN KEY(project_id,period,network) REFERENCES monthly_payment_authorizations(project_id,period,network)
) STRICT;
CREATE TRIGGER monthly_payment_authorization_attempts_no_update BEFORE UPDATE ON monthly_payment_authorization_attempts
BEGIN SELECT RAISE(ABORT,'monthly execution attempt immutable'); END;
CREATE TRIGGER monthly_payment_authorization_attempts_no_delete BEFORE DELETE ON monthly_payment_authorization_attempts
BEGIN SELECT RAISE(ABORT,'monthly execution attempt permanent'); END;

-- Decimal strings can exceed SQLite's int64. Canonical length/text ordering
-- chooses the latest attempt without rounding or replacing the original row.
CREATE VIEW monthly_payment_current_authorizations AS
 SELECT a.project_id,a.period,a.network,a.snapshot_sha256,
        coalesce(t.authorization,a.authorization) authorization,
        coalesce(t.published_at,a.published_at) published_at
 FROM monthly_payment_authorizations a
 LEFT JOIN monthly_payment_authorization_attempts t
 ON t.project_id=a.project_id AND t.period=a.period AND t.network=a.network
 AND t.source_sequence=(
   SELECT source_sequence FROM monthly_payment_authorization_attempts n
   WHERE n.project_id=a.project_id AND n.period=a.period AND n.network=a.network
   ORDER BY length(source_sequence) DESC,source_sequence DESC LIMIT 1
 );

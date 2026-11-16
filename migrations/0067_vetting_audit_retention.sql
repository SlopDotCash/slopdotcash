-- The owner approved one year of scanner access logs. Keep newer records
-- immutable even when a caller tries to delete them outside the scheduler.
DROP TRIGGER vetting_evidence_audit_no_delete;
CREATE TRIGGER vetting_evidence_audit_retention
BEFORE DELETE ON vetting_evidence_audit
WHEN julianday(OLD.created_at) IS NULL
  OR julianday(OLD.created_at) >= julianday('now', '-1 year')
BEGIN
  SELECT RAISE(ABORT, 'scanner audit records require one year of retention');
END;
CREATE INDEX vetting_evidence_audit_retention_date
ON vetting_evidence_audit(created_at);

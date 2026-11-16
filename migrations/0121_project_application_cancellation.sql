-- Applicant withdrawals retain the original application and decision evidence.
-- Reuse the historical rejected terminal storage value so the live foreign-key
-- parent table and its pending uniqueness indexes do not need a rebuild. The
-- API maps this explicit marker to the distinct cancelled state.
ALTER TABLE project_applications ADD COLUMN applicant_cancelled_at TEXT CHECK (
  applicant_cancelled_at IS NULL OR (
    status = 'rejected' AND applicant_cancelled_at = decided_at AND
    decided_by_github_id = applicant_github_id AND
    decision_reason = 'Cancelled by applicant'
  )
);

CREATE TRIGGER project_application_cancel_pending
BEFORE UPDATE ON project_applications
WHEN OLD.applicant_cancelled_at IS NULL AND NEW.applicant_cancelled_at IS NOT NULL
  AND OLD.status <> 'pending'
BEGIN SELECT RAISE(ABORT, 'only a pending application can be cancelled'); END;

CREATE TRIGGER project_application_cancel_terminal
BEFORE UPDATE ON project_applications
WHEN OLD.applicant_cancelled_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'cancelled application is immutable'); END;

CREATE TRIGGER project_application_cancel_no_delete
BEFORE DELETE ON project_applications
WHEN OLD.applicant_cancelled_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'cancelled application is permanent'); END;

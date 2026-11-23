-- The release sweep's one try at the owner's notice of an older-style link
-- (`createCase`, mode `claim`) whose deposit no longer holds it while GitHub
-- has not confirmed the link yet (PRD section 8, "Report deposit"). The
-- security API (`backend/security/report-deposit.ts`, `startReleasedWork`)
-- sets the time once it has tried, whether or not a notice row was written:
-- a project with no technical approver who has current GitHub authority, or
-- one that was retired, writes none, and the claim must not take the sweep's
-- slots again. A link that GitHub confirms later is notified by its own
-- receipt event.
ALTER TABLE security_report_deposits ADD COLUMN claim_notice_at TEXT;
-- A try that met a GitHub outage is not recorded in `claim_notice_at`; its
-- time goes here instead, and the sweep orders retried claims behind claims
-- not tried yet, so a lasting outage cannot keep later claims from their
-- notice.
ALTER TABLE security_report_deposits ADD COLUMN claim_retry_at TEXT;

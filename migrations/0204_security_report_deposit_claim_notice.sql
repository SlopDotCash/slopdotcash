-- spec/security/reportDeposit.md, "Unpaid asks are released when the switch or the project turns the deposit off": the
-- release sweep's try at the owner notice of a reporter's claim whose deposit no longer holds it while GitHub has not
-- confirmed the link yet. The sweep sets `claim_notice_at` once a try told the owners or found nobody to tell, and
-- never tries that claim again. A try that failed is not recorded there: its time goes to `claim_retry_at`, and the
-- sweep takes claims with no failed try first, then the oldest failed try. The development tree adds the same two
-- columns in its `0155_security_report_deposit_claim_notice.sql`.
ALTER TABLE security_report_deposits ADD COLUMN claim_notice_at TEXT;
ALTER TABLE security_report_deposits ADD COLUMN claim_retry_at TEXT;

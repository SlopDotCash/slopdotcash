-- The refundable SLOP deposit on a private security report (operator
-- decision, 21 November 2026; PRD section 8, "Report deposit"). One row per
-- report the deposit applies to. It holds no reporter, title or report text.
--
-- The security API (`backend/security/report-deposit.ts`) inserts the row
-- when the report is accepted, with the SLOP amount fixed at that moment:
-- `asked` while `SECURITY_REPORT_DEPOSIT` is `live`, `recorded` in `dry_run`.
-- A `recorded` row asks nobody and holds nothing. The same code later sets
-- `refund_due` or `kept_due` on a paid row from the report's own state, and
-- turns an unpaid `asked` row back into `recorded` when the deposit stops
-- applying (that row keeps the reason 'turned-off' and the time, with no
-- outcome). The submission-fee Worker sets `paid_*` when it sees an accepted
-- deposit and writes the final `refunded` or `kept` after its transaction.
-- The Worker sends what is due and never decides it.
CREATE TABLE security_report_deposits (
  case_id TEXT PRIMARY KEY,           -- the Slop case id (sc_...)
  project_id TEXT NOT NULL,
  item TEXT NOT NULL UNIQUE,          -- reportDepositItem(case_id)
  mode TEXT NOT NULL,                 -- 'asked' | 'recorded'
  slop_amount TEXT NOT NULL,          -- base units due, decimal string, fixed when asked
  slop_per_usd TEXT NOT NULL,         -- the rate used
  asked_at TEXT NOT NULL,
  paid_at TEXT,                       -- set by the Worker (session B)
  paid_network TEXT,
  paid_deposit_id INTEGER,
  outcome TEXT,                       -- null | 'refund_due' | 'kept_due' | 'refunded' | 'kept'
  outcome_reason TEXT,                -- fixed words: 'responded' | 'silent' | 'turned-off' | 'spam' | 'duplicate' | 'out-of-scope'
  outcome_at TEXT
);

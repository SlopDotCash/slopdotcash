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

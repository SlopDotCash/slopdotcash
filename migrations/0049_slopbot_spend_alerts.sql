-- One attempt per UTC month and $500 milestone. A claimed attempt without a
-- receipt is ambiguous: never automatically resend a possibly accepted email.
CREATE TABLE slopbot_spend_alerts (
 month TEXT NOT NULL,
 threshold_micro_usd INTEGER NOT NULL CHECK(threshold_micro_usd > 0 AND threshold_micro_usd % 500000000 = 0),
 recorded_micro_usd INTEGER NOT NULL CHECK(recorded_micro_usd >= threshold_micro_usd),
 estimated_calls INTEGER NOT NULL CHECK(estimated_calls >= 0),
 claimed_at TEXT NOT NULL,
 PRIMARY KEY(month, threshold_micro_usd)
) STRICT;
CREATE TABLE slopbot_spend_alert_receipts (
 month TEXT NOT NULL,
 threshold_micro_usd INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','ambiguous')),
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(month, threshold_micro_usd),
 FOREIGN KEY(month, threshold_micro_usd) REFERENCES slopbot_spend_alerts(month, threshold_micro_usd)
) STRICT;

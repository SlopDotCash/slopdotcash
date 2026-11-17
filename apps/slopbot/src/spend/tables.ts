// spec/slopbot/spendAlerts.md, "One claim per run, in order, and an ambiguous send is never resent"; spec/slopbot/spendAlerts.md, "A failed call notice is claimed before it is sent"

export const spendWrites = [
  "slopbot_spend_alerts",
  "slopbot_spend_alert_receipts",
  "slopbot_provider_failure_notices",
  "slopbot_provider_failure_receipts",
] as const;

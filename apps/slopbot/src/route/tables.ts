// spec/slopbot/spendAlerts.md, "Each new call appends an immutable cost row with zero customer charge"

export const routeWrites = ["slopbot_costs"] as const;

export const routeLegacyReads = ["slopbot_credits"] as const;

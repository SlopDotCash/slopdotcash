// spec/slopbot/valueRequests.md, "Blocked outcomes back off, transient ones wait an hour, final ones stop"; spec/slopbot/valueRequests.md, "Overlapping groups contend by permanent source ID"

export const requestWrites = ["slopbot_value_processing", "slopbot_value_parked_checks", "slopbot_value_source_leases"] as const;

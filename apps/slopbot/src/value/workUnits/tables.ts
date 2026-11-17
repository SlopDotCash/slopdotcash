// spec/slopbot/workUnits.md, "One transaction checks predecessors, legacy records, sources, claims and the publication fence"

export const workUnitWrites = ["slopbot_work_unit_journal", "slopbot_work_unit_sources", "slopbot_work_unit_claims", "slopbot_work_unit_predecessors"] as const;

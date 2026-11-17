// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"; spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"

export const evidenceTables = [
  "vetting_evidence_runs",
  "vetting_evidence_objects",
  "vetting_evidence_grants",
  "vetting_evidence_audit",
  "vetting_evidence_completions",
  "vetting_evidence_case_closures",
  "vetting_evidence_deletions",
  "vetting_evidence_cleanup_claims",
  "vetting_evidence_generations",
  "vetting_evidence_targets",
  "vetting_evidence_heads",
  "vetting_evidence_target_retirements",
  "vetting_storage_cycles",
  "security_intake_access_log",
  "private_audit_events",
] as const;

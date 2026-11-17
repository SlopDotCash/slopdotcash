// spec/operations/backup.md, "One cycle copies an ordered verified prefix and completes one manifest"; spec/operations/backup.md, "Retention needs a proven restoration, and never deletes admission evidence or unbacked bytes"; spec/operations/backup.md, "Backups expire after thirty days and access-log entries after one year"
export const backupWrites = [
  "vetting_storage_cycles",
  "vetting_evidence_audit",
  "vetting_evidence_deletions",
  "vetting_evidence_generations",
  "vetting_evidence_target_retirements",
] as const;

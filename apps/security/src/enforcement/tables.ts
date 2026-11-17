// spec/security/enforcement.md, "Journals only append and lifting a human restriction needs its decision"; spec/security/enforcement.md, "The second distinct active flag quarantines a clear project and later flags only record"; spec/security/enforcement.md, "An administrator records an audited exemption only for a current authorized steward"

export const enforcementTables = [
  "project_enforcements",
  "project_flags",
  "project_vetting_reinstatements",
  "vetting_admission_exemptions",
  "vetting_admission_exemption_revocations",
] as const;

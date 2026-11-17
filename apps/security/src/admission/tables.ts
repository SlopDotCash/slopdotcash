// spec/security/admission.md, "An assessment is bound to its queued revision, commit and template"; spec/security/admission.md, "Publication records its intent, sends once, keeps uncertainty and records the result exactly once"

export const admissionTables = [
  "vetting_assessments",
  "vetting_artifacts",
  "vetting_publication_intents",
  "vetting_publication_receipts",
] as const;

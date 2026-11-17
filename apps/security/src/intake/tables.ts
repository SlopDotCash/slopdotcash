// spec/security/intake.md, "Upload and receipt creation have separate durable states"; spec/security/intake.md, "Only verified exact object bytes permit an atomic case and Inbox receipt"
export const intakeTables = [
  "security_intake_rate_admissions",
  "security_submission_intake",
  "security_intake_reports",
  "security_intake_events",
  "security_submissions",
  "security_submission_events",
  "security_cases",
  "security_case_events",
] as const;

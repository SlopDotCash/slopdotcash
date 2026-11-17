// spec/security/reportingReadiness.md, "A refresh writes only a newer attempt and keeps the repository identity"
export const readinessWrites = ["repository_reporting_status"] as const;

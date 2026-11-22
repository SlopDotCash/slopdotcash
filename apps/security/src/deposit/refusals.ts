// spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"; spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"
export const depositRequiredMessage = "This report waits for its deposit. Nothing else happens to it until the deposit is recorded.";

export const depositRefusals = {
  depositRequired: { status: 409, error: "deposit_required", message: depositRequiredMessage },
  invalidSpam: { status: 400, error: "invalid_request", message: "Invalid spam" },
  onlyRejectedSpam: { status: 400, error: "invalid_request", message: "Only a rejected report can be marked spam" },
} as const;

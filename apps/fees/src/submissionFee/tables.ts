// spec/fees/submissionFeeDeposits.md, "A deposit is recorded once confirmed and final once finalized, and a reorganised one stops paying"

export const writes = ["submission_fee_deposits", "submission_fee_cursors"] as const;

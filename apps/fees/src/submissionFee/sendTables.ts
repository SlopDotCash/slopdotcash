// spec/fees/submissionFeeSends.md, "A signed send is recorded before broadcast and one send per network is in flight"

export const writes = ["submission_fee_sends", "submission_fee_parked"] as const;

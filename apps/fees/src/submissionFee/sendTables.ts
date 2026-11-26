// spec/fees/submissionFeeSends.md, "A signed send is recorded before broadcast and one send per network is in flight"

export const writes = [
  "submission_fee_sends",
  "submission_fee_parked",
  "submission_fee_solana_sends",
  "submission_fee_solana_scans",
  "submission_fee_solana_settlements",
] as const;

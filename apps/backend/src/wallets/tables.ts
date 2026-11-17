// spec/backend/wallets.md, "Claim and proof history remains bound to one partition"
export const writes = [
  "wallet_claims",
  "payment_wallet_challenges",
  "payment_wallet_authorizations",
  "wallet_possession_challenges",
  "wallet_possession_attestations",
] as const;

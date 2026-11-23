// spec/backend/wallets.md, "Claim and proof history remains bound to one partition"; spec/backend/wallets.md, "The effective claim and held deliveries follow the authorized claim"
export const writes = [
  "wallet_claims",
  "payment_wallet_challenges",
  "payment_wallet_authorizations",
  "wallet_possession_challenges",
  "wallet_possession_attestations",
  "payment_outbox",
] as const;

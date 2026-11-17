// spec/settlement/directBounty.md, "Each finalized transaction belongs to one ledger and one exact request"; spec/settlement/directBounty.md, "Paid legs and prior intent generations remain permanent"

export const writes = [
  "security_payment_consents",
  "security_direct_payments",
  "security_direct_nonce_reservations",
  "security_direct_transfer_receipts",
  "security_direct_payment_receipts",
  "security_direct_transaction_uses",
  "security_direct_payment_revisions",
  "security_direct_recovery_scans",
] as const;

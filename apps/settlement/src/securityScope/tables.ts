// spec/settlement/payment.md, "A reserved vault accepts an exact canonical scanner event"; spec/settlement/paymentDispatch.md, "Story: Recover uncertainty without opening a competing transfer"
export const writes = [
  "security_payment_obligations",
  "security_payment_events",
  "security_payment_outbox",
  "security_payment_attempts",
  "security_payment_attempt_failures",
  "security_payment_chain_cursors",
  "security_payment_solana_scans",
  "security_payment_solana_scan_pages",
  "security_vault_snapshots",
] as const;

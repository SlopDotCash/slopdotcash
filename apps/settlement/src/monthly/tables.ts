// spec/settlement/monthly.md, "Story: Propose one month once from accepted work"; spec/settlement/monthlySettings.md, "The journal is append-only and the current value is its last entry"; spec/settlement/monthlyCommitment.md, "The first authorization, signed attempts and freeze time are immutable"; spec/settlement/maintainerShare.md, "A change starts with the next UTC month, and a month is proposed only from a complete read"

export const writes = [
  "monthly_reward_bases",
  "monthly_reward_base_rows",
  "monthly_maintainer_shares",
  "monthly_maintainer_share_parts",
  "monthly_maintainer_share_rows",
  "monthly_allocation_changes",
  "monthly_allocation_cut_reasons",
  "monthly_payment_settings",
  "monthly_payment_runs",
  "monthly_payment_obligations",
  "monthly_payment_exclusions",
  "monthly_payment_authorizations",
  "monthly_payment_authorization_attempts",
  "monthly_payment_execution",
] as const;

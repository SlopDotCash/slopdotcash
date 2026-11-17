// spec/settlement/vaultSnapshots.md, "The write compares the latest row atomically"
export const writes = ["vault_snapshots", "vault_month_starts"] as const;

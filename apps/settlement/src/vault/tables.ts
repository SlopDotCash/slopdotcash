// spec/settlement/vaultSnapshots.md, "The write compares the latest row atomically"; spec/settlement/vaultSnapshots.md, "An ordinary vault read stores its month pledges, keeping the newest read of each month"
export const writes = ["vault_snapshots", "vault_month_starts", "vault_month_pledges"] as const;

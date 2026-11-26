// spec/settlement/vaultDeposits.md, "A run reads pages up to the finalized block and stores each page with its cursor"; spec/settlement/solanaVaultDeposits.md, "A run reads newest first below the interval it resumes and above the covered position"
export const writes = ["vault_deposits", "vault_deposit_cursors"] as const;

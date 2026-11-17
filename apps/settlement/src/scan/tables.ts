// spec/settlement/evmScan.md, "Completion advances the cursor monotonically, even when runs finish out of order"; spec/settlement/solanaScan.md, "Store one page per invocation and keep the old cursor as the interval boundary"
export const writes = ["payment_chain_cursors", "payment_solana_scans", "payment_solana_scan_pages"] as const;

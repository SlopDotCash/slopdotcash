/**
 * Every escrow counter of one vault, read at one finalized block (EVM) or slot (Solana). Both
 * adapters export `readVaultTotals` returning this shape. Counters are token base-unit decimal
 * integer text; a counter the vault does not have is null.
 */
export interface VaultTotals {
  /** The registry network key (deployment.network). */
  network: string;
  /** EVM vault address (lowercase) or Solana project PDA. */
  vault: string;
  /** Token address or SPL mint, read from chain. */
  asset: string;
  /** ERC-20 decimals() or the mint's decimals, read from chain. Display only. */
  decimals: number;
  /** EVM finalized block number or Solana finalized slot, decimal text. */
  blockNumber: string;
  /** ISO-8601 time of that block. */
  blockTime: string;
  totalDeposited: string;
  /** Contributor net only. */
  totalPaid: string;
  totalPayoutFees: string;
  totalGrossWithdrawn: string;
  /** Included in totalGrossWithdrawn. */
  totalWithdrawalFees: string;
  freeBalance: string | null;
  /** EVM only; Solana stores one combined reserve. */
  reservedPrincipal: string | null;
  /** EVM only. */
  reservedFees: string | null;
  /** Fees held in the vault until claimFees (EVM) or claim_fees (Solana). */
  accruedFees: string | null;
  /** Combined reserve when present, including an admitted month not yet materialized as awards. */
  reserved: string | null;
}

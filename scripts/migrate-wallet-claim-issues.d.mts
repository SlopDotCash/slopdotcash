/** Types the one-time GitHub wallet-claim migration for focused tests. */

export interface HistoricalWalletClaim {
  address: string;
  githubActorId: string;
  githubLogin: string;
  issueNumber: number;
  observedAt: string;
  sourceBodySha256: string;
  sourceUrl: string;
}

export interface WalletMigrationOptions {
  claims?: HistoricalWalletClaim[];
  closeIssue?: boolean;
  fetch?: WalletMigrationFetch;
  refreshClaim?: (
    issueNumber: number,
  ) => HistoricalWalletClaim | Promise<HistoricalWalletClaim>;
  tokenProvider?: (fetchImpl: WalletMigrationFetch) => Promise<string>;
}

export type WalletMigrationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function main(
  values?: string[],
  options?: WalletMigrationOptions,
): Promise<void>;

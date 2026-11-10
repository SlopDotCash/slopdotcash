import type { WalletChain } from "./wallets";

/** Immutable wallet evidence shared by allocation records and their cycle index. */
export interface ProfileReadmeWalletProof {
  address: string;
  chain: WalletChain;
  observedAt: string;
  sourceCommit: string;
  sourceUrl: string;
}

export interface GithubIssueWalletProof {
  address: string;
  chain: WalletChain;
  observedAt: string;
  sourceActorId: string;
  sourceBodySha256: string;
  sourceIssueId: string;
  sourceIssueNumber: number;
  sourceUpdatedAt: string;
  sourceUrl: string;
}

export interface SlopDatabaseWalletProof {
  address: string;
  chain: WalletChain;
  observedAt: string;
  sourceActorId: string;
  sourceClaimId: string;
  sourceRecordSha256: string;
  /**
   * Digest of the signed possession attestation for this claim, as published
   * by the claim's public possession view (`messageDigest`). Required on
   * Solana proofs: a claim records only the authenticated account's
   * statement of an address, so a Solana proof without this reference must
   * not be used as a cycle-index wallet proof. The trace possession flow
   * issues attestations for Solana only, so proofs on other chains carry no
   * attestation reference.
   */
  sourceAttestationSha256?: string;
  sourceUrl: string;
}

export type WalletProof =
  | ProfileReadmeWalletProof
  | GithubIssueWalletProof
  | SlopDatabaseWalletProof;

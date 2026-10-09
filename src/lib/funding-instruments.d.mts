/** Types the shared reviewed committed-funding instrument validator. */

export interface MonthlyCommitmentBinding {
  readonly cycleId: string;
  readonly amountMinor: string;
  readonly accessibility: "unknown";
}

export interface SquadsV4VaultInstrument {
  readonly kind: "squads-v4-vault";
  readonly network: "solana";
  readonly asset: "USDC";
  readonly multisig: string;
  readonly vault: string;
  readonly vaultIndex: number;
  readonly funderActorId: string;
  readonly funderMember: string;
  readonly stewardMember: string;
  readonly stewardGithub?: {
    readonly actorId: string;
    readonly nodeId: string;
    readonly login: string;
  };
  readonly monthlyCommitment?: MonthlyCommitmentBinding;
  readonly deadline: string;
  readonly effectiveAt: string;
  readonly replacedAt: string | null;
}

export interface GithubIdentityReference {
  readonly actorId: string;
  readonly nodeId: string;
  readonly login: string;
}

/** RFC #500 2-of-3 project vault. Slop holds a vote-only key; see funding/README.md. */
export interface SquadsProjectVaultInstrument {
  readonly kind: "squads-project-vault";
  readonly network: "solana";
  readonly asset: "USDC";
  readonly multisig: string;
  readonly vault: string;
  readonly vaultIndex: number;
  readonly creatorActorId: string;
  /** Canonical vault of the creator's own multisig, never a plain key. */
  readonly creatorMember: string;
  readonly creatorMultisig: string;
  readonly creatorVaultIndex: number;
  readonly slopMember: string;
  readonly independentMember: string;
  readonly independentGithub: GithubIdentityReference;
  /** Declared on-chain time lock; the verifier publishes the observed value. */
  readonly timeLockSeconds: number;
  /** Fallback wait kept by signer agreement and checked after the fact. */
  readonly fallbackWaitSeconds: number;
  readonly monthlyCommitment: MonthlyCommitmentBinding;
  readonly deadline: string;
  readonly effectiveAt: string;
  readonly replacedAt: string | null;
}

export interface SablierLockupV4Instrument {
  readonly monthlyCommitment?: MonthlyCommitmentBinding;
  readonly kind: "sablier-lockup-v4";
  readonly network: "base" | "ethereum";
  readonly asset: "USDC";
  readonly contract: string;
  readonly recipient: string;
  /** Reviewed GitHub actor attesting control of `recipient` (RFC #472). */
  readonly recipientGithub?: GithubIdentityReference;
  readonly streamId: string;
  readonly deadline: string;
  readonly effectiveAt: string;
  readonly replacedAt: string | null;
}

export type FundingCommitmentInstrument =
  | SquadsV4VaultInstrument
  | SquadsProjectVaultInstrument
  | SablierLockupV4Instrument;

export declare const PROJECT_VAULT_MAX_TIME_LOCK_SECONDS: number;
export declare const PROJECT_VAULT_DEFAULT_TIME_LOCK_SECONDS: number;
export declare const PROJECT_VAULT_DEFAULT_FALLBACK_WAIT_SECONDS: number;

export declare const SABLIER_LOCKUP_V4_CONTRACTS: {
  readonly base: "0xc19a09a66887017f603e5df420ed3cb9a5c07c0a";
  readonly ethereum: "0x93b37bd5b6b278373217333ac30d7e74c85fbdcb";
};

export declare function assertFundingCommitments(
  value: unknown,
  field?: string,
): readonly FundingCommitmentInstrument[];

export declare function hasActiveFundingCommitment(value: unknown): boolean;

export declare function assertMonthlyCommitmentPolicy(
  value: import("./projects.mjs").ProjectDefinition,
): void;

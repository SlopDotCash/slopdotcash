/** Types for the standing deposit (PRD section 5, "Standing deposit"; section 6, FEE-08). */

export declare const STANDING_DEPOSIT_NETWORK: "robinhood-mainnet";
export declare const STANDING_DEPOSIT_LEDGER: "robinhood-standing";
/** Null until the second `SubmissionDeposits` deployment is recorded. */
export declare const STANDING_DEPOSIT_CONTRACT: string | null;
export declare const STANDING_DEPOSIT_START_BLOCK: number | null;
export declare const STANDING_DEPOSIT_RECLAIM_DAYS: number;
export declare const STANDING_DEPOSIT_USD_MINOR: string;
export declare const STANDING_DEPOSIT_STRIKE_WINDOW_DAYS: number;
export declare const STANDING_DEPOSIT_STRIKE_GRACE_HOURS: number;
export declare const STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS: number;
export declare const STANDING_DEPOSIT_OPEN_CAP: number;
export declare const STANDING_DEPOSIT_COVER_DAYS: number;
export declare const STANDING_DEPOSIT_COVERED_LABEL: "slopbot:deposit-covered";

/** `keccak256(abi.encodePacked("slop-standing-v1", uint64(githubId), uint64(round)))`, lowercase 0x hex. */
export declare function standingDepositItem(
  githubId: number | string | bigint,
  round: number | string | bigint,
): string;

/** SLOP base units for the deposit at a rate, rounded up to a whole SLOP; null without a rate. */
export declare function standingDepositAmount(
  slopPerUsd: string | null | undefined,
): string | null;

/** True once the contract address and start block are recorded. */
export declare function standingDepositDeployed(
  contract?: string | null,
  startBlock?: number | null,
): boolean;

/** True unless the project's owner refused standing deposits. */
export declare function standingDepositsAccepted(
  project:
    | {
        readonly slopbot?: {
          readonly submissionFee?: { readonly standingDeposits?: boolean };
        };
      }
    | null
    | undefined,
): boolean;

export interface StandingDepositFacts {
  readonly paidAt: string | null;
  readonly withdrawRequestedAt?: string | null;
  readonly cancelledAt?: string | null;
  readonly outcome: string | null;
}

/** When the deposit stops covering new pull requests; null when unpaid. */
export declare function standingCoverEndsAt(
  deposit: StandingDepositFacts | null | undefined,
): Date | null;

/** Whether a standing deposit covers a pull request opened at `openedAt`. */
export declare function standingDepositCovers(facts: {
  readonly deposit: StandingDepositFacts | null;
  readonly accepted: boolean;
  readonly mergedOnProject: boolean | null;
  readonly openCovered: number;
  readonly openedAt: string;
}): boolean;

export type StandingCoverState = "watch" | "pending" | "clear" | "strike";

/** What a covered pull request means for its deposit now. */
export declare function standingCoverState(
  facts: {
    readonly windowStart: string;
    readonly merged: boolean;
    readonly closed: boolean;
    readonly closedAt: string | null;
    readonly keepMarked: boolean;
    readonly strikeSeenAt: string | null;
  },
  now: Date,
): StandingCoverState;

/** What is due on a paid standing deposit with no outcome yet. */
export declare function standingDepositDue(
  deposit: StandingDepositFacts | null | undefined,
  coverStates: readonly StandingCoverState[],
  now: Date,
): "kept_due" | "refund_due" | null;

/** Types for the standing deposit's shared constants and rules (PRD section 5). */

export declare const STANDING_DEPOSIT_NETWORK: "robinhood-mainnet";
export declare const STANDING_DEPOSIT_LEDGER: "robinhood-standing";
export declare const STANDING_DEPOSIT_CONTRACT: string | null;
export declare const STANDING_DEPOSIT_START_BLOCK: number | null;
export declare const STANDING_DEPOSIT_RECLAIM_DAYS: number;
export declare const STANDING_DEPOSIT_USD_MINOR: string;
export declare const STANDING_DEPOSIT_STRIKE_WINDOW_DAYS: number;
export declare const STANDING_DEPOSIT_STRIKE_GRACE_HOURS: number;
export declare const STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS: number;
export declare const STANDING_DEPOSIT_OPEN_CAP: number;
export declare const STANDING_DEPOSIT_COVER_DAYS: number;
export declare const STANDING_DEPOSIT_COVERED_LABEL: string;

export type StandingDepositFacts = {
  readonly paidAt: string | null;
  readonly withdrawRequestedAt?: string | null;
  readonly outcome: string | null;
  readonly cancelledAt?: string | null;
};
export type StandingCoverState = "watch" | "pending" | "clear" | "strike";

export declare function standingDepositItem(
  githubId: number | string | bigint,
  round: number | string | bigint,
): string;
export declare function standingDepositAmount(
  slopPerUsd: string | null | undefined,
): string | null;
export declare function standingDepositDeployed(
  contract?: string | null,
  startBlock?: number | null,
): boolean;
export declare function standingDepositsAccepted(
  project:
    | {
        readonly slopbot?: {
          readonly submissionFee?: {
            readonly enabled?: boolean;
            readonly amountMinor?: string;
            readonly standingDeposits?: boolean;
          };
        };
      }
    | null
    | undefined,
): boolean;
export declare function standingCoverEndsAt(
  deposit: StandingDepositFacts | null | undefined,
): Date | null;
export declare function standingDepositCovers(facts: {
  readonly deposit: StandingDepositFacts | null;
  readonly accepted: boolean;
  readonly mergedOnProject: boolean;
  readonly openCovered: number;
  readonly openedAt: string | null | undefined;
}): boolean;
export declare function standingCoverState(
  facts: {
    readonly windowStart: string | null | undefined;
    readonly merged: boolean;
    readonly closed: boolean;
    readonly closedAt: string | null | undefined;
    readonly keepMarked: boolean;
    readonly strikeSeenAt: string | null | undefined;
  },
  now: Date,
): StandingCoverState;
export declare function standingDepositDue(
  deposit: StandingDepositFacts | null | undefined,
  coverStates: readonly StandingCoverState[],
  now: Date,
): "kept_due" | "refund_due" | null;

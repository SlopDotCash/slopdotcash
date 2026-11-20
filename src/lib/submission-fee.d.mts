/** Types for the refundable submission fee (PRD section 6). */

export type SubmissionFeeNetwork = "base-mainnet" | "robinhood-mainnet";

export type SubmissionFeeTokenTable = Readonly<
  Record<string, { usdc?: string; usdg?: string; slop?: string }>
>;

/** Local rehearsals replace the mainnet tables; production passes none. */
export type SubmissionFeeTerms = {
  readonly tokens?: SubmissionFeeTokenTable;
  readonly contracts?: Readonly<Record<string, string | null>>;
  readonly keptTo?: Readonly<Record<string, string>>;
  readonly burn?: string;
  readonly chainIds?: Readonly<Record<string, number>>;
};

export type SubmissionFeeRate = {
  readonly effectiveAt: string;
  readonly slopPerUsd: string;
};

export type SubmissionFeeItemView = {
  readonly stableMinor: string;
  readonly paidNetwork?: string | null;
  readonly paidDepositId?: number | string | null;
  readonly outcome?: string | null;
};

export type SubmissionFeeRefusal =
  | "unknown_item"
  | "token_not_accepted"
  | "wrong_kept_to"
  | "item_fee_invalid"
  | "no_slop_rate"
  | "amount_below_due"
  | "item_already_paid"
  | "item_already_decided";

export type SubmissionFeeOption = {
  readonly network: string;
  readonly chainId: number | null;
  readonly contract: string | null;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  /** The amount to pay now, in base units. */
  readonly amount: string;
  /** The least amount accepted now; lower than `amount` only in a rate's 48 hours. */
  readonly minimumAccepted: string;
  readonly keptTo: string;
};

export declare const SUBMISSION_FEE_BURN: string;
export declare const SUBMISSION_FEE_KEPT_TO: Readonly<Record<string, string>>;
export declare const SUBMISSION_FEE_TOKENS: SubmissionFeeTokenTable;
export declare const SUBMISSION_FEE_CONTRACTS: Readonly<
  Record<SubmissionFeeNetwork, string | null>
>;
export declare const SUBMISSION_FEE_SWITCHED_ON: boolean;
export declare const SUBMISSION_FEE_DEFAULT_MINOR: string;
export declare const SUBMISSION_FEE_MIN_MINOR: string;
export declare const SUBMISSION_FEE_MAX_MINOR: string;
export declare const SUBMISSION_FEE_SLOP_SHARE_BPS: number;
export declare const SUBMISSION_FEE_REFUND_UNDECIDED_DAYS: number;
export declare const SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS: number;
export declare const SUBMISSION_FEE_RECLAIM_DAYS: number;
export declare const SUBMISSION_FEE_START_BLOCKS: Readonly<
  Record<SubmissionFeeNetwork, number | null>
>;
export declare const SUBMISSION_FEE_CHAIN_IDS: Readonly<
  Record<SubmissionFeeNetwork, number>
>;
export declare const SUBMISSION_FEE_CONFIRMATIONS: Readonly<
  Record<SubmissionFeeNetwork, number>
>;
export declare const SUBMISSION_FEE_STABLE_DECIMALS: number;
export declare const SUBMISSION_FEE_SLOP_DECIMALS: number;
export declare const SUBMISSION_FEE_RATE_GRACE_MS: number;
export declare const SUBMISSION_FEE_RATE_PERIOD_MS: number;
export declare const SUBMISSION_FEE_SLOP_BAND_BPS: Readonly<{
  min: number;
  max: number;
}>;
export declare const SUBMISSION_FEE_UNKNOWN_ITEM_GRACE_MS: number;

export declare function submissionFeeItem(
  repositoryId: number | string | bigint,
  pullNumber: number | string | bigint,
): `0x${string}`;
export declare function validStableFee(stableMinor: unknown): boolean;
export declare function slopRateScaled(slopPerUsd: string): bigint;
export declare function slopRateText(scaled: bigint): string;
export declare function slopFeeBase(
  stableMinor: string,
  slopPerUsd: string,
): string;
export declare function slopRatesAt(
  rates: readonly SubmissionFeeRate[],
  at: string,
): {
  current: SubmissionFeeRate | null;
  previous: (SubmissionFeeRate & { acceptedUntil: string }) | null;
};
export declare function slopFeeDueAt(
  stableMinor: string,
  rates: readonly SubmissionFeeRate[],
  at: string,
): string | null;
export declare function submissionFeeTokenKind(
  network: string,
  token: string,
  terms?: SubmissionFeeTerms,
): "stable" | "slop" | null;
export declare function submissionDepositCounts(
  network: string,
  deposit: {
    readonly depositId: number | string;
    readonly token: string;
    readonly amount: string;
    readonly keptTo: string;
    readonly blockTime: string;
  },
  item: SubmissionFeeItemView | null,
  rates: readonly SubmissionFeeRate[],
  terms?: SubmissionFeeTerms,
):
  | { accepted: true; kind: "stable" | "slop"; due: string }
  | { accepted: false; reason: SubmissionFeeRefusal };
export declare function submissionResolveAction(
  network: string,
  deposit: {
    readonly depositId: number | string;
    readonly token: string;
    readonly finalizedAt: string | null;
    readonly state: string;
    readonly accepted: number | boolean | null;
  },
  item: Omit<SubmissionFeeItemView, "stableMinor"> | null,
  terms?: SubmissionFeeTerms,
): "refund" | "keep" | null;
export declare function slopFeeShareBps(
  rateInForce: string,
  marketRate: string,
): number;
export declare function averageSlopRate(readings: readonly string[]): string;
export declare function nextSlopRate(input: {
  current: SubmissionFeeRate | null;
  at: string;
  week: readonly string[];
  day: readonly string[];
}): { slopPerUsd: string; reason: "first" | "weekly" | "drift" } | null;
export declare function submissionFeeOptions(
  stableMinor: string,
  rates: readonly SubmissionFeeRate[],
  at: string,
  terms?: SubmissionFeeTerms,
): SubmissionFeeOption[];

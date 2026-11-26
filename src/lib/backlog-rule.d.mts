/** Types for the backlog rule (PRD sections 5 and 7). */

/** One stored merge activity row; absent or null fields leave it out. */
export type BacklogRow = {
  readonly waitingOutside?: number | null;
  readonly lastMergedAt?: string | null;
  readonly observedAt: string | null;
};

export type CatchUpStart = { readonly startedAt: string };

export type BacklogSlopbot = {
  readonly catchUpUntil?: string;
  readonly catchUpHistory?: readonly CatchUpStart[];
};

export type BacklogProject = {
  readonly status: string;
  readonly listingTier?: string;
  readonly reward?: {
    readonly kind?: string;
    readonly monthlyCapMinor?: string;
  };
  readonly securityBounty?: { readonly rewardMode?: string } | null;
  readonly slopbot?: BacklogSlopbot;
};

export type BacklogFigures = {
  readonly waiting: number;
  readonly lastMergedAt: string | null;
};

export type BacklogState = {
  readonly judged: boolean;
  readonly figures: BacklogFigures | null;
  readonly daysSinceMerge: number | null;
  readonly reason: "backlog" | "dormant" | null;
  readonly catchingUpUntil: string | null;
  readonly started: boolean;
  readonly wouldBeOut: boolean;
  readonly outOfRotation: boolean;
};

export declare const BACKLOG_WAITING_LIMIT: number;
export declare const DORMANT_AFTER_DAYS: number;
export declare const DORMANT_WARNING_AFTER_DAYS: number;
export declare const CATCH_UP_MAX_DAYS: number;
export declare const BACKLOG_RULE_FROM: string;
export declare const CATCH_UP_HISTORY_MAX: number;
export declare function assertCatchUpUntil(
  value: unknown,
  field: string,
): asserts value is string;
export declare function assertCatchUpHistory(
  value: unknown,
  field: string,
): asserts value is CatchUpStart[];
export declare function securityOnly(
  project: BacklogProject | null | undefined,
): boolean;
export declare function backlogJudged(
  project: BacklogProject | null | undefined,
): boolean;
export declare function backlogRuleStarted(now: Date): boolean;
export declare function backlogFigures(
  rows: readonly BacklogRow[] | null | undefined,
  now: Date,
): BacklogFigures | null;
export declare function catchUpEnd(
  project: { readonly slopbot?: BacklogSlopbot } | null | undefined,
  now: Date,
): string | null;
export declare function backlogState(
  project: BacklogProject,
  rows: readonly BacklogRow[] | null | undefined,
  now: Date,
): BacklogState;
export declare function backlogOutOfRotation(
  project: BacklogProject,
  rows: readonly BacklogRow[] | null | undefined,
  now: Date,
): boolean;
export declare function dormancyNear(state: BacklogState): boolean;
export declare function backlogDate(iso: string): string;
export declare function backlogNotice(state: BacklogState): string | null;
export declare function backlogStatusLine(state: BacklogState): string | null;
export declare function backlogPreviewDetail(state: BacklogState): string;
export declare function backlogWarningDetail(state: BacklogState): string;
export declare function backlogOutDetail(state: BacklogState): string;
export declare function applyCatchUpChange<T extends BacklogSlopbot>(
  previous: BacklogSlopbot | undefined,
  next: T | undefined,
  now: Date,
): (T & { readonly catchUpHistory?: readonly CatchUpStart[] }) | undefined;
export declare function catchUpOfferedEnd(now: Date): string;
export declare function catchUpStartAllowed(
  project: { readonly slopbot?: BacklogSlopbot } | null | undefined,
  now: Date,
): boolean;

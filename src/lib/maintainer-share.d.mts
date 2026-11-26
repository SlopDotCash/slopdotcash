/** Types for a project's maintainer share (PRD section 6). */

export type MaintainerShareHistoryEntry = {
  /** The last UTC month, YYYY-MM, that had this share. */
  readonly throughCycle: string;
  readonly basisPoints: number;
};

type MaintainerShareReward = {
  readonly kind?: string;
  readonly maintainerShare?: number;
  readonly maintainerShareHistory?: readonly MaintainerShareHistoryEntry[];
};

export declare const MAINTAINER_SHARE_LIMITS: Readonly<{
  min: number;
  max: number;
}>;
export declare function assertMaintainerShare(
  value: unknown,
  field: string,
): asserts value is number;
export declare function assertMaintainerShareHistory(
  value: unknown,
  field: string,
): asserts value is MaintainerShareHistoryEntry[];
export declare function maintainerShareBasisPoints(
  project: { readonly reward?: MaintainerShareReward } | null | undefined,
  cycleId: string,
): number;
export declare function prospectiveMaintainerShare<
  T extends MaintainerShareReward,
>(
  before: MaintainerShareReward,
  after: T,
  openCycle: string,
): T & {
  readonly maintainerShareHistory?: readonly MaintainerShareHistoryEntry[];
};
export declare function maintainerShareLabel(
  points: number | null | undefined,
): string;
type MaintainerShareProject = {
  readonly reward?: MaintainerShareReward & {
    readonly monthlyCapMinor?: string;
  };
};
export declare function publishedMaintainerShare(
  project: MaintainerShareProject | null | undefined,
  now: Date,
): { current: number; next: number; nextCycle: string } | null;
export declare function maintainerShareNotice(
  project: MaintainerShareProject | null | undefined,
  now: Date,
): string | null;
export declare function maintainerShareCardLine(
  project: MaintainerShareProject | null | undefined,
  now: Date,
): string | null;

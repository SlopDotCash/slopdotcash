/** Types for runtime validation of pull-request project manifests. */

import type { ProjectDefinition } from "./projects.mjs";

export declare const MAX_MONTHLY_CAP_MINOR: bigint;
export declare const MAX_PROJECT_ID_LENGTH: 43;
export declare const PROJECT_SKILL_TEMPLATES: Readonly<{
  contributor: "skills/project-contributor-template";
  reviewer: "skills/project-reviewer-template";
}>;
export declare const CONTRIBUTION_FIELDS: readonly ContributionField[];
export type ContributionField =
  | "approvedScope"
  | "contributionGuide"
  | "supportedTasks"
  | "requiredTests"
  | "reviewExpectations"
  | "securityContact"
  | "closurePolicy"
  | "maintainerNotes";
export declare function expectedRewardFeeBasisPoints(
  kind: "monthly-pool" | "external-prize-share",
  escrow: boolean,
): 100 | 200 | 1000;
export declare function formatMonthlyCapDisplay(value: string): string;
export declare function parseAssetAmount(
  value: string,
  decimals: number,
): string;
export declare function monthlyAmountDisplay(
  value: string,
  rewardAsset:
    | {
        kind: "stablecoin" | "token" | "native";
        decimals: number;
        symbol: string;
      }
    | undefined,
): string;
export declare function assertProjectDefinition(
  value: unknown,
): ProjectDefinition;
export declare function assertHistoricalProjectDefinition(
  value: unknown,
): ProjectDefinition;
export declare function assertProjectRegistry(
  values: unknown,
): ProjectDefinition[];

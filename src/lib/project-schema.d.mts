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
export declare const DIRECT_FUNDING_DISCLOSURE: "Funds go directly to the project wallet. Slop does not hold or recover funds.";
export declare const VAULT_FUNDING_DISCLOSURE: "Funds are committed in the project vault. Slop holds no payment keys.";
export declare function projectFeeBasisPoints(policy: {
  kind: "monthly-pool" | "external-prize-share";
  escrow: unknown;
  disclosure: string | undefined;
}): 100 | 200 | 1000;
export declare function formatMonthlyCapDisplay(value: string): string;
export declare function formatAssetAmount(
  value: string,
  decimals: number,
): string;
export declare function parseAssetAmount(
  value: string,
  decimals: number,
): string;
export declare function monthlyAmountDisplay(
  value: string,
  rewardAsset:
    | { kind: "stablecoin" | "token"; decimals: number; symbol: string }
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

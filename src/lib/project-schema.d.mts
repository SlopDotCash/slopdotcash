/** Types for runtime validation of pull-request project manifests. */

import type { ProjectDefinition } from "./projects.mjs";

export declare const MAX_MONTHLY_CAP_MINOR: bigint;
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
export declare function formatMonthlyCapDisplay(value: string): string;
export declare function assertProjectDefinition(
  value: unknown,
): ProjectDefinition;
export declare function assertHistoricalProjectDefinition(
  value: unknown,
): ProjectDefinition;
export declare function assertProjectRegistry(
  values: unknown,
): ProjectDefinition[];

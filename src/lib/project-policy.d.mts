/** Types for project policy transition checks. */

import type { ProjectDefinition } from "./projects.mjs";

export type VerifiedBranchChange = {
  readonly repositoryId: string;
  readonly from: string;
  readonly to: string;
};

export declare function assertProjectPolicyTransition(
  previousValue: unknown,
  nextValue: unknown,
  branchChange?: VerifiedBranchChange,
): ProjectDefinition;

/** Key-order-insensitive serialization used for manifest comparisons. */
export declare function canonical(value: unknown): string;

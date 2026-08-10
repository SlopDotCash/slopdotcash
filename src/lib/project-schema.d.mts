/** Types for runtime validation of pull-request project manifests. */

import type { ProjectDefinition } from "./projects.mjs";

export declare const MAX_MONTHLY_CAP_MINOR: bigint;
export declare function formatMonthlyCapDisplay(value: string): string;
export declare function assertProjectDefinition(
  value: unknown,
): ProjectDefinition;
export declare function assertProjectRegistry(
  values: unknown,
): ProjectDefinition[];

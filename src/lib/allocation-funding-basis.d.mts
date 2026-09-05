import type { ProjectDefinition } from "./projects.mjs";
export interface AllocationFundingBasis {
  cycleId: string;
  instrumentId: string | null;
  fundingState: "committed" | "pledged";
  committedMinor: string;
  monthlyCapMinor: string;
}
export function assertAllocationFundingBasis(
  value: unknown,
): AllocationFundingBasis;
export function deriveAllocationFundingBasis(
  project: ProjectDefinition,
  cycleId: string,
): AllocationFundingBasis;

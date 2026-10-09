import type { FundingCommitmentInstrument } from "./funding-instruments.mjs";
import type { ProjectDefinition } from "./projects.mjs";
/** Stable public instrument identity frozen in an allocation funding basis. */
export function fundingInstrumentId(
  instrument: FundingCommitmentInstrument,
): string;
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

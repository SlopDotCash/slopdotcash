import { isBaseUnits } from "./escrow-policy.mjs";

/** Frozen monetary basis for new proposals; accepted score is independent. */

export type { AllocationFundingBasis } from "./allocation-funding-basis.mjs";
export {
  assertAllocationFundingBasis,
  deriveAllocationFundingBasis,
} from "./allocation-funding-basis.mjs";

// July is the final historical cap-based cycle. Its artifacts are never rewritten.
export const LAST_LEGACY_CAP_CYCLE = "2026-07";

export function allocationFundingMinor(basis: {
  fundingState: string;
  committedMinor: string;
  monthlyCapMinor: string;
}): bigint {
  const validated = assertFundingAmounts({
    fundingState: basis.fundingState,
    committedMinor: basis.committedMinor,
    monthlyCapMinor: basis.monthlyCapMinor,
  });
  if (validated.fundingState !== "committed") return 0n;
  const committed = BigInt(validated.committedMinor);
  const cap = BigInt(validated.monthlyCapMinor);
  return committed < cap ? committed : cap;
}

function assertFundingAmounts(value: unknown): {
  fundingState: "committed" | "pledged";
  committedMinor: string;
  monthlyCapMinor: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("allocation funding basis must be an object");
  }
  const basis = value as Record<string, unknown>;
  if (
    Object.keys(basis).sort().join(",") !==
      "committedMinor,fundingState,monthlyCapMinor" ||
    (basis.fundingState !== "pledged" && basis.fundingState !== "committed") ||
    !isBaseUnits(basis.committedMinor) ||
    !isBaseUnits(basis.monthlyCapMinor)
  ) {
    throw new TypeError("invalid allocation funding basis");
  }
  return {
    fundingState: basis.fundingState,
    committedMinor: basis.committedMinor,
    monthlyCapMinor: basis.monthlyCapMinor,
  };
}

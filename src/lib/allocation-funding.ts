/** Frozen monetary basis for new proposals; accepted score is independent. */
import type { CycleIndexEntry } from "./cycle-index";
import type { ProjectDefinition } from "./projects.mjs";

export interface AllocationFundingBasis {
  fundingState: "committed" | "pledged";
  committedMinor: string;
  monthlyCapMinor: string;
}

// July is the final historical cap-based cycle. Its artifacts are never rewritten.
export const LAST_LEGACY_CAP_CYCLE = "2026-07";

export function allocationFundingMinor(basis: {
  fundingState: string;
  committedMinor: string;
  monthlyCapMinor: string;
}): bigint {
  const validated = assertAllocationFundingBasis({
    fundingState: basis.fundingState,
    committedMinor: basis.committedMinor,
    monthlyCapMinor: basis.monthlyCapMinor,
  });
  if (validated.fundingState !== "committed") return 0n;
  const committed = BigInt(validated.committedMinor);
  const cap = BigInt(validated.monthlyCapMinor);
  return committed < cap ? committed : cap;
}

export function assertAllocationFundingBasis(
  value: unknown,
): AllocationFundingBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("allocation funding basis must be an object");
  }
  const basis = value as Record<string, unknown>;
  if (
    Object.keys(basis).sort().join(",") !==
      "committedMinor,fundingState,monthlyCapMinor" ||
    (basis.fundingState !== "pledged" && basis.fundingState !== "committed") ||
    typeof basis.committedMinor !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/u.test(basis.committedMinor) ||
    typeof basis.monthlyCapMinor !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/u.test(basis.monthlyCapMinor)
  ) {
    throw new TypeError("invalid allocation funding basis");
  }
  return {
    fundingState: basis.fundingState,
    committedMinor: basis.committedMinor,
    monthlyCapMinor: basis.monthlyCapMinor,
  };
}

export type PromotionCycle = Pick<
  CycleIndexEntry,
  "cycleId" | "projectId" | "kind"
> & { reward: Pick<CycleIndexEntry["reward"], "fundingBasis"> };

/** Missing history cannot authorize promotion; funded projects may resume it. */
export function projectPromotionEligible(
  project: ProjectDefinition,
  cycles: readonly PromotionCycle[] | null,
): boolean {
  if (project.reward.kind !== "monthly-pool") return true;
  if (cycles === null) return false;
  if (allocationFundingMinor(project.reward) > 0n) return true;
  const history = cycles
    .filter(
      (cycle) =>
        cycle.projectId === project.id && cycle.kind === "monthly-pool",
    )
    .sort((left, right) => right.cycleId.localeCompare(left.cycleId));
  let consecutive = 0;
  let previousMonth: number | null = null;
  for (const cycle of history) {
    const [year, month] = cycle.cycleId.split("-").map(Number);
    const monthOrdinal = year * 12 + month;
    if (previousMonth !== null && monthOrdinal !== previousMonth - 1) break;
    previousMonth = monthOrdinal;
    if (
      cycle.reward.fundingBasis &&
      allocationFundingMinor(cycle.reward.fundingBasis) > 0n
    )
      break;
    consecutive += 1;
    if (consecutive >= 2) return false;
  }
  return true;
}

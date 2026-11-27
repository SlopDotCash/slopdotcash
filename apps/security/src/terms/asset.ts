// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/terms.md, "A fixed offer permits its receipt-time gross amount or no award"
import { platformShare, researcherShare, splitPossible } from "./kernel.ts";

export interface AwardShares {
  readonly grossMinor: string;
  readonly researcherMinor: string;
  readonly slopMinor: string;
}

export type SplitOutcome = { readonly kind: "split"; readonly shares: AwardShares } | { readonly kind: "indivisible"; readonly message: string };

const baseUnits = /^[0-9]+$/u;

/** @throws {never} */
export function limbsOf(base: string): number[] {
  if (!baseUnits.test(base)) return [];
  const digits = base.replace(/^0+(?=.)/u, "");
  const parts: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) parts.push(Number(digits.slice(Math.max(0, end - 3), end)));
  return parts;
}

/** @throws {never} */
export function awardSplit(grossMinor: string, full: boolean): SplitOutcome {
  const gross = BigInt(grossMinor);
  if (!splitPossible(gross, full)) return { kind: "indivisible", message: "gross amount must be divisible by four minor units so the 75/25 split is exact" };
  return { kind: "split", shares: { grossMinor, researcherMinor: researcherShare(gross, full).toString(), slopMinor: platformShare(gross, full).toString() } };
}

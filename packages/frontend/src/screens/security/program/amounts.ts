// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import { bountySharePreview, type SharePreview } from "@repo/security/client";
import type { ProgramTerms } from "./terms.schema.ts";

export type { SharePreview };

/** The published gross and its researcher and Slop shares, or undefined when the gross does not split exactly. @throws {never} */
export function programShares(terms: Pick<ProgramTerms, "amount" | "split">): SharePreview | undefined {
  return bountySharePreview(terms.amount, terms.amount.grossMinor, terms.amount.grossMinor, terms.split);
}

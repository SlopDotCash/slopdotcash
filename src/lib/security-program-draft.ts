import {
  SECURITY_SPLIT,
  type SecurityBountySplitPolicy,
  type SecurityBountyTerms,
} from "./security-bounty.mjs";

/** Owners keep the approved split; all new programs use the common split. */
export function initialSecuritySplit(
  existing?: Pick<SecurityBountyTerms, "split">,
): SecurityBountySplitPolicy {
  return existing?.split ?? SECURITY_SPLIT;
}

/** Keep scope, settlement and other published terms while rebuilding edited fields. */
export function carriedSecurityTerms(
  existing?: SecurityBountyTerms,
): Partial<Omit<SecurityBountyTerms, "fundingPolicy">> {
  if (!existing) return {};
  const { fundingPolicy: _fundingPolicy, ...previous } = existing;
  return previous;
}

/**
 * The editor collects the scope lists one entry per line, but its textareas
 * bound only the whole box (10,000 characters). The terms validator bounds
 * each entry instead — 2 to 200 characters, at most 50 entries — and the
 * editor skips that validator for a new program or a changed asset, so a
 * publish that follows the on-screen guidance can still be refused by the
 * API with a message that never names the bound. Check the lists on every
 * publish path and name the bound the API enforces.
 */
export function securityScopeListProblem(
  scope: Pick<
    SecurityBountyTerms["scope"],
    "includedAssets" | "excludedDependencies"
  >,
): string | null {
  const lists = [
    ["Covered assets", scope.includedAssets, 1],
    ["Excluded dependencies", scope.excludedDependencies, 0],
  ] as const;
  for (const [label, entries, minimum] of lists) {
    if (
      entries.length < minimum ||
      entries.length > 50 ||
      entries.some((entry) => entry.length < 2 || entry.length > 200)
    )
      return `${label}: use one entry per line, 2 to 200 characters each, at most 50 lines.`;
  }
  return null;
}

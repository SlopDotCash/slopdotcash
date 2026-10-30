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

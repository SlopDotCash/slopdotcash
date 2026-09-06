/** Repository-owned authority checks, separate from read-only chain evidence. */
import type { FundingRecordDecision } from "./check-funding-record-pr";

export const FUNDING_MERGE_POLICY_VERSION = "funding-record-merge-v2";
export const QUALITY_CONTEXT = "Skill, data, build, and browser checks";

export interface FundingMergeProtection {
  requiresStatusChecks: boolean;
  requiresStrictStatusChecks: boolean;
  requiredStatusCheckContexts: string[];
  isAdminEnforced: boolean;
  requiresApprovingReviews: boolean;
  requiredApprovingReviewCount: number;
  dismissesStaleReviews: boolean;
  requiresConversationResolution: boolean;
  allowsForcePushes: boolean;
  allowsDeletions: boolean;
  bypassPullRequestAllowances: { totalCount: number };
}

export function assertFundingMergeProtection(
  protection: FundingMergeProtection | null,
): void {
  if (
    protection?.requiresStatusChecks !== true ||
    protection.requiresStrictStatusChecks !== true ||
    !protection.requiredStatusCheckContexts.includes(QUALITY_CONTEXT) ||
    protection.isAdminEnforced !== true ||
    protection.requiresApprovingReviews !== true ||
    protection.requiresConversationResolution !== true ||
    protection.allowsForcePushes !== false ||
    protection.allowsDeletions !== false ||
    protection.bypassPullRequestAllowances.totalCount !== 0
  ) {
    throw new Error("Strict non-bypassable branch protection is required");
  }
}

export function assertFundingMergeDecision(
  decision: FundingRecordDecision,
  expected: { baseSha: string; headSha: string; number: number; now: number },
): void {
  const age = expected.now - Date.parse(decision.checkedAt);
  if (
    decision.decision !== "verified-records" ||
    decision.mergeAuthorized !== false ||
    decision.baseSha !== expected.baseSha ||
    decision.checkerRevision !== expected.baseSha ||
    decision.headSha !== expected.headSha ||
    decision.pullRequestNumber !== expected.number ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 5 * 60 * 1000 ||
    decision.records.length === 0 ||
    decision.records.some(
      (record) =>
        !record.verifierVersion ||
        !record.verifierOutputCanonical ||
        !record.verifierOutputSha256,
    )
  ) {
    throw new Error(
      "Fresh exact-base/head verified funding evidence is required",
    );
  }
}

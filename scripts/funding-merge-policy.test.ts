import { describe, expect, it } from "vitest";
import type { FundingRecordDecision } from "./check-funding-record-pr";
import {
  assertFundingMergeDecision,
  assertFundingMergeProtection,
  type FundingMergeProtection,
  QUALITY_CONTEXT,
} from "./funding-merge-policy";

const protection: FundingMergeProtection = {
  requiresStatusChecks: true,
  requiresStrictStatusChecks: true,
  requiredStatusCheckContexts: [QUALITY_CONTEXT],
  isAdminEnforced: true,
  requiresApprovingReviews: true,
  requiredApprovingReviewCount: 1,
  dismissesStaleReviews: true,
  requiresConversationResolution: true,
  allowsForcePushes: false,
  allowsDeletions: false,
  bypassPullRequestAllowances: { totalCount: 0 },
};

describe("standing funding merge authority", () => {
  it("accepts strict, reviewed, non-bypassable protection", () => {
    expect(() => assertFundingMergeProtection(protection)).not.toThrow();
  });
  it.each([
    null,
    { requiresStatusChecks: false },
    { requiresStrictStatusChecks: false },
    { requiredStatusCheckContexts: [] },
    { isAdminEnforced: false },
    { requiresApprovingReviews: false },
    { requiredApprovingReviewCount: 0 },
    { dismissesStaleReviews: false },
    { requiresConversationResolution: false },
    { allowsForcePushes: true },
    { allowsDeletions: true },
    { bypassPullRequestAllowances: { totalCount: 1 } },
  ])("rejects missing/weakened protection %j", (change) => {
    expect(() =>
      assertFundingMergeProtection(change && { ...protection, ...change }),
    ).toThrow();
  });

  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const now = Date.parse("2026-09-05T20:00:00Z");
  const decision: FundingRecordDecision = {
    kind: "funding-record-pr-decision",
    schemaVersion: "1",
    checkerVersion: "funding-record-gate-v1",
    checkerRevision: baseSha,
    baseSha,
    headSha,
    pullRequestNumber: 1,
    checkedAt: new Date(now).toISOString(),
    decision: "verified-records",
    mergeAuthorized: false,
    reason: "verified",
    records: [
      {
        path: "funding/example/solana/transaction/fund_example.json",
        recordBlobOid: "c".repeat(40),
        recordBytesSha256: "d".repeat(64),
        verificationInput: null,
        verifierVersion: "verifier-v1",
        verifierOutputCanonical: "{}\n",
        verifierOutputSha256: "e".repeat(64),
      },
    ],
  };
  const expected = { baseSha, headSha, number: 1, now };
  it("requires fresh evidence for this exact base/head and PR", () => {
    expect(() => assertFundingMergeDecision(decision, expected)).not.toThrow();
  });
  it.each([
    { decision: "human-review-required" },
    { decision: "verification-failed" },
    { mergeAuthorized: true },
    { baseSha: headSha },
    { checkerRevision: headSha },
    { headSha: baseSha },
    { pullRequestNumber: 2 },
    { checkedAt: new Date(now - 300_001).toISOString() },
    { checkedAt: new Date(now + 1).toISOString() },
    { checkedAt: "not a date" },
    { records: [] },
    { records: [{ ...decision.records[0], verifierOutputSha256: null }] },
  ])("refuses non-transferable evidence %j", (change) => {
    expect(() =>
      assertFundingMergeDecision(
        { ...decision, ...change } as FundingRecordDecision,
        expected,
      ),
    ).toThrow();
  });
});

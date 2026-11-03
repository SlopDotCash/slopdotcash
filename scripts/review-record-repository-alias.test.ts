import { describe, expect, test } from "bun:test";
import {
  assertReviewRecord,
  assertReviewRecordReceiptJoin,
  type ReviewRecord,
} from "../src/lib/review-records";
import type { ProjectRunReceipt } from "../src/lib/run-receipts";

const OLD_ARTIFACT = "https://github.com/elizaOS/asi/pull/2606";
const CURRENT_ARTIFACT = "https://github.com/SlopDotCash/asi/pull/2606";
const HEAD_SHA = "25e9567efc061a5d04a28daaa732ef21ab483bcf";
const RUN_ID = "run_00000000000000000000000000";

function reviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    schemaVersion: "2",
    projectId: "asi",
    artifactUrl: OLD_ARTIFACT,
    headSha: HEAD_SHA,
    provider: "openai",
    model: "gpt-5",
    client: "codex",
    runId: RUN_ID,
    traceSha256: null,
    recommendation: "accept",
    reproduced: true,
    securityRisk: "none",
    duplicateRisk: "none",
    splitRisk: "none",
    effortBand: "small",
    complexity: "moderate",
    impact: "meaningful",
    reviewLoad: "standard",
    recommendedTier: "small",
    recommendedThirds: 3,
    workUnitId: "wu_asi_repository_transfer_review",
    confidenceBasisPoints: 9000,
    valueRationale: "The review reproduces and verifies the accepted outcome.",
    usefulArtifacts: [OLD_ARTIFACT],
    commands: ["bun test"],
    evidenceUrls: [OLD_ARTIFACT],
    summary: "Verified the pull request at its immutable head.",
    ...overrides,
  };
}

const receipt = {
  projectId: "asi",
  runId: RUN_ID,
  provider: "openai",
  model: "gpt-5",
  client: "codex",
  traceUpload: null,
} as ProjectRunReceipt;

describe("review records after a registered repository transfer", () => {
  test("accepts the repository's recorded former path", () => {
    expect(assertReviewRecord(reviewRecord()).artifactUrl).toBe(OLD_ARTIFACT);
  });

  test("joins the former path to the current URL for the same pull request", () => {
    expect(
      assertReviewRecordReceiptJoin(reviewRecord(), receipt, {
        artifactUrl: CURRENT_ARTIFACT,
        headSha: HEAD_SHA,
      }).artifactUrl,
    ).toBe(OLD_ARTIFACT);
  });

  test("does not join a different pull request on the same repository", () => {
    expect(() =>
      assertReviewRecordReceiptJoin(reviewRecord(), receipt, {
        artifactUrl: "https://github.com/SlopDotCash/asi/pull/2607",
        headSha: HEAD_SHA,
      }),
    ).toThrow("slop-review record does not match its artifact head");
  });

  test("rejects a former path that is not registered to the project", () => {
    expect(() =>
      assertReviewRecord(
        reviewRecord({
          artifactUrl: "https://github.com/elizaOS/eliza/pull/2606",
        }),
      ),
    ).toThrow("review record artifactUrl is outside the project");
  });
});

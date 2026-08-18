import { describe, expect, it } from "vitest";
import {
  assertReviewRecord,
  assertReviewRecordReceiptJoin,
  parseReviewRecordBlock,
} from "./review-records";
import type { ProjectRunReceipt } from "./run-receipts";

const record = {
  schemaVersion: "2",
  projectId: "eliza",
  artifactUrl: "https://github.com/elizaOS/eliza/pull/123",
  headSha: "a".repeat(40),
  provider: "x-ai/hosted+edge",
  model: "accounts/x/models/grok-4.5+reasoning",
  client: "grok-build+acp",
  runId: "run_01K3JZ6Y7E8M9N0P1Q2R3S4T5V",
  traceSha256: "b".repeat(64),
  recommendation: "accept",
  reproduced: true,
  securityRisk: "none",
  duplicateRisk: "none",
  splitRisk: "none",
  effortBand: "medium",
  complexity: "moderate",
  impact: "meaningful",
  reviewLoad: "deep",
  recommendedTier: "medium",
  recommendedThirds: 9,
  workUnitId: "wu_eliza_pr_123",
  confidenceBasisPoints: 8500,
  valueRationale:
    "This fixes the observed regression and adds focused coverage.",
  usefulArtifacts: [],
  commands: ["bun test"],
  evidenceUrls: [],
  summary: "The focused regression test passed at the reviewed head.",
};

const receipt: ProjectRunReceipt = {
  schemaVersion: "1",
  runId: record.runId,
  projectId: "eliza",
  repositoryId: "elizaOS/eliza",
  startedAt: "2026-08-15T10:00:00.000Z",
  completedAt: "2026-08-15T11:00:00.000Z",
  provider: record.provider,
  model: record.model,
  client: record.client,
  skillRevision: `elizaOS/slopdotcash@${"a".repeat(40)}:skills/contribute-to-eliza`,
  skillSha256: "c".repeat(64),
  usage: {
    source: "none",
    confidence: "unavailable",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costMicroUsd: "0",
    sessionCount: 0,
  },
  trajectorySha256: record.traceSha256,
  traceUpload: {
    authority: "https://api.slop.cash",
    serverRunId: "server_review_test",
    objectId: `sha256:${record.traceSha256}`,
    sha256: record.traceSha256,
  },
  signatureAlgorithm: "ed25519",
  devicePublicKey: "A".repeat(44),
  deviceKeyId: "d".repeat(64),
  deviceSignature: "B".repeat(86),
};

const context = {
  artifactUrl: record.artifactUrl,
  headSha: record.headSha,
};

describe("review records", () => {
  it("accepts exact arbitrary provider, model, and client identities", () => {
    expect(assertReviewRecord(record)).toMatchObject({
      provider: record.provider,
      model: record.model,
      client: record.client,
      traceSha256: record.traceSha256,
    });
  });

  it.each(["provider", "model", "client"])(
    "rejects a placeholder %s",
    (field) => {
      expect(() => assertReviewRecord({ ...record, [field]: field })).toThrow(
        /not exact/u,
      );
    },
  );

  it("requires mandatory trace attribution", () => {
    const { traceSha256: _, ...missingTrace } = record;
    expect(() => assertReviewRecord(missingTrace)).toThrow(/missing/u);
  });

  it("parses one fenced record and joins it to finalized receipt evidence", () => {
    const parsed = parseReviewRecordBlock(
      `findings\n\n\`\`\`slop-review\n${JSON.stringify(record)}\n\`\`\``,
    );
    expect(assertReviewRecordReceiptJoin(parsed, receipt, context)).toEqual(
      record,
    );
  });

  it("rejects a missing finalized trace upload", () => {
    expect(() =>
      assertReviewRecordReceiptJoin(
        record,
        { ...receipt, traceUpload: null },
        context,
      ),
    ).toThrow(/finalized private trace upload/u);
  });

  it.each([
    ["run", { ...record, runId: `run_${"A".repeat(26)}` }, receipt, context],
    ["trace", { ...record, traceSha256: "e".repeat(64) }, receipt, context],
    [
      "artifact",
      record,
      receipt,
      { ...context, artifactUrl: "https://github.com/elizaOS/eliza/pull/999" },
    ],
    ["head", record, receipt, { ...context, headSha: "f".repeat(40) }],
  ])("rejects a mismatched %s join", (_name, value, run, sourceContext) => {
    expect(() =>
      assertReviewRecordReceiptJoin(value, run, sourceContext),
    ).toThrow(/does not match/u);
  });
});

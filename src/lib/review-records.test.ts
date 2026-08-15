import { describe, expect, it } from "vitest";
import { assertReviewRecord } from "./review-records";

const record = {
  schemaVersion: "1",
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
  usefulArtifacts: [],
  commands: ["bun test"],
  evidenceUrls: [],
  summary: "The focused regression test passed at the reviewed head.",
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
});

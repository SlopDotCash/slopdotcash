/** Exercises strict project-run marker validation and adversarial failures. */

import { describe, expect, it } from "vitest";
import {
  assertRunReceiptMarker,
  type ProjectRunReceipt,
  parseRunMarker,
  runReceiptMarker,
  serializeRunMarker,
} from "./run-receipts";

const receipt: ProjectRunReceipt = {
  schemaVersion: "1",
  runId: "run_01K3JZ6Y7E8M9N0P1Q2R3S4T5V",
  projectId: "eliza",
  repositoryId: "elizaOS/eliza",
  startedAt: "2026-08-07T10:00:00.000Z",
  completedAt: "2026-08-07T11:00:00.000Z",
  provider: "openai",
  model: "gpt-5.6-sol",
  client: "codex",
  skillRevision: `elizaOS/army@${"a".repeat(40)}:skills/contribute-to-eliza`,
  skillSha256: "b".repeat(64),
  usage: {
    source: "ccusage-session-v20",
    confidence: "exact",
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 25,
    totalTokens: 175,
    costMicroUsd: "125000",
    sessionCount: 1,
  },
  trajectorySha256: "c".repeat(64),
  signatureAlgorithm: "ed25519",
  devicePublicKey: "A".repeat(44),
  deviceKeyId: "d".repeat(64),
  deviceSignature: "B".repeat(86),
};

describe("project run receipt", () => {
  it("round-trips the canonical final-line marker", () => {
    const marker = serializeRunMarker(receipt);
    expect(marker).toContain("elizaos-contribution-attribution:v2");
    expect(parseRunMarker(marker)).toEqual(receipt);
  });

  it("rejects repository and project mismatches", () => {
    const marker = runReceiptMarker(receipt);
    marker.run.repository = "lalalune/arklib";
    expect(() => assertRunReceiptMarker(marker)).toThrow(
      /does not belong to the project/u,
    );
  });

  it("rejects models outside the frozen frontier policy", () => {
    const marker = runReceiptMarker(receipt);
    marker.model = "gpt-4";
    expect(() => assertRunReceiptMarker(marker)).toThrow(/not approved/u);
  });

  it("requires unavailable usage to be exactly zero", () => {
    const marker = runReceiptMarker(receipt);
    marker.run.usage.confidence = "unavailable";
    expect(() => assertRunReceiptMarker(marker)).toThrow(/zero values/u);
  });

  it("rejects extra fields and noncanonical money", () => {
    const marker = runReceiptMarker(receipt) as unknown as Record<
      string,
      unknown
    >;
    marker.admin = true;
    expect(() => assertRunReceiptMarker(marker)).toThrow(/unexpected/u);

    const invalidMoney = runReceiptMarker(receipt);
    invalidMoney.run.usage.cost_micro_usd = "01";
    expect(() => assertRunReceiptMarker(invalidMoney)).toThrow(/minor units/u);
  });
});

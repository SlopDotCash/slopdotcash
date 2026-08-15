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
  skillRevision: `elizaOS/slopdotcash@${"a".repeat(40)}:skills/contribute-to-eliza`,
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
  traceUpload: {
    authority: "https://api.slop.cash",
    serverRunId: "srv_test",
    objectId: `sha256:${"c".repeat(64)}`,
    sha256: "c".repeat(64),
  },
  signatureAlgorithm: "ed25519",
  devicePublicKey: "A".repeat(44),
  deviceKeyId: "d".repeat(64),
  deviceSignature: "B".repeat(86),
};

describe("project run receipt", () => {
  it("round-trips the canonical final-line marker", () => {
    const marker = serializeRunMarker(receipt);
    expect(marker).toContain("slop-contribution-attribution:v1");
    expect(parseRunMarker(marker)).toEqual(receipt);
  });

  it("rejects repository and project mismatches", () => {
    const marker = runReceiptMarker(receipt);
    marker.run.repository = "elizaos/proximityprize";
    expect(() => assertRunReceiptMarker(marker)).toThrow(
      /does not belong to the project/u,
    );
  });

  it("accepts any concrete declared provider, model, and client", () => {
    const marker = runReceiptMarker(receipt);
    marker.provider = "xai";
    marker.model = "grok-4";
    marker.client = "grok-build";
    expect(assertRunReceiptMarker(marker)).toMatchObject({
      provider: "xai",
      model: "grok-4",
      client: "grok-build",
    });

    marker.model = "N/A";
    expect(() => assertRunReceiptMarker(marker)).toThrow(/concrete/u);
  });

  it("allows unsupported clients to report diagnostic usage as unavailable", () => {
    const marker = runReceiptMarker(receipt);
    marker.client = "kimi-cli";
    marker.provider = "moonshot";
    marker.model = "kimi-k2";
    marker.run.usage = {
      source: "none",
      confidence: "unavailable",
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      cost_micro_usd: "0",
      session_count: 0,
    };
    expect(assertRunReceiptMarker(marker).usage).toEqual({
      source: "none",
      confidence: "unavailable",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costMicroUsd: "0",
      sessionCount: 0,
    });
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

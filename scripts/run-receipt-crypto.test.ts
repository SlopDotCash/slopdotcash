/** Verifies signed run receipts and rejects key substitution or data tampering. */

import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ProjectRunReceipt,
  runReceiptSigningPayload,
} from "../src/lib/run-receipts";
import { deviceKeyId, verifyRunReceiptSignature } from "./run-receipt-crypto";

function signedReceipt(): ProjectRunReceipt {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
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
    trajectorySha256: null,
    signatureAlgorithm: "ed25519",
    devicePublicKey: publicKeyDer.toString("base64url"),
    deviceKeyId: deviceKeyId(publicKeyDer),
    deviceSignature: "A".repeat(86),
  };
  receipt.deviceSignature = sign(
    null,
    Buffer.from(runReceiptSigningPayload(receipt), "utf8"),
    privateKey,
  ).toString("base64url");
  return receipt;
}

describe("run receipt cryptography", () => {
  it("verifies canonical Ed25519 receipt bytes", () => {
    const receipt = signedReceipt();
    expect(verifyRunReceiptSignature(receipt)).toEqual(receipt);
  });

  it("rejects token tampering and key-id substitution", () => {
    const tampered = signedReceipt();
    tampered.usage.totalTokens += 1;
    expect(() => verifyRunReceiptSignature(tampered)).toThrow(/signature/u);

    const substituted = signedReceipt();
    substituted.deviceKeyId = "f".repeat(64);
    expect(() => verifyRunReceiptSignature(substituted)).toThrow(/key id/u);
  });
});

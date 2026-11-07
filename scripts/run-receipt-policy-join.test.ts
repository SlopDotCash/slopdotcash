import { expect, test } from "bun:test";
import {
  assertRunReceiptPolicyJoin,
  type ProjectRunReceipt,
} from "../src/lib/run-receipts";

const LICENSE_A = "a".repeat(64);
const LICENSE_B = "b".repeat(64);
const INBOUND_A = "c".repeat(64);
const INBOUND_B = "d".repeat(64);

const REV_A_AT = "2026-01-01T00:00:00.000Z";
const REV_B_AT = "2026-02-01T00:00:00.000Z";

type ProjectParam = Parameters<typeof assertRunReceiptPolicyJoin>[1];

function activeProject(): ProjectParam {
  return {
    id: "example",
    terms: {
      revision: "terms-b",
      receiptPolicy: {
        state: "active",
        activatedAt: REV_A_AT,
        bindings: [
          {
            policyRevision: "terms-a",
            licenseSha256: LICENSE_A,
            inboundTermsSha256: INBOUND_A,
            prizeRulesSha256: null,
            activatedAt: REV_A_AT,
          },
          {
            policyRevision: "terms-b",
            licenseSha256: LICENSE_B,
            inboundTermsSha256: INBOUND_B,
            prizeRulesSha256: null,
            activatedAt: REV_B_AT,
          },
        ],
      },
      repositoryLicense: { fileSha256: LICENSE_B },
      inbound: { fileSha256: INBOUND_B },
      externalPrize: null,
    },
  } as unknown as ProjectParam;
}

function receipt(
  acknowledgement: {
    policyRevision: string;
    licenseSha256: string;
    inboundTermsSha256: string;
  },
  startedAt: string,
  completedAt: string,
): ProjectRunReceipt {
  return {
    schemaVersion: "2",
    runId: "run_00000000000000000000000000",
    projectId: "example",
    repositoryId: 1,
    startedAt,
    completedAt,
    provider: "provider",
    model: "model",
    client: "client",
    skillRevision: "owner/repo@0000000000000000000000000000000000000000:path",
    skillSha256: "e".repeat(64),
    policyAcknowledgement: {
      ...acknowledgement,
      prizeRulesSha256: null,
      acknowledgedAt: startedAt,
    },
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
    trajectorySha256: null,
    traceUpload: null,
    signatureAlgorithm: "ed25519",
    devicePublicKey: "f".repeat(64),
    deviceKeyId: "key",
    deviceSignature: "0".repeat(128),
  } as unknown as ProjectRunReceipt;
}

const ACK_A = {
  policyRevision: "terms-a",
  licenseSha256: LICENSE_A,
  inboundTermsSha256: INBOUND_A,
};
const ACK_B = {
  policyRevision: "terms-b",
  licenseSha256: LICENSE_B,
  inboundTermsSha256: INBOUND_B,
};

test("a run started while the old terms were in force may keep them", () => {
  const run = receipt(
    ACK_A,
    "2026-01-15T00:00:00.000Z",
    "2026-02-03T00:00:00.000Z",
  );
  expect(assertRunReceiptPolicyJoin(run, activeProject())).toBe(run);
});

test("a run acknowledging the current terms passes", () => {
  const run = receipt(
    ACK_B,
    "2026-02-02T00:00:00.000Z",
    "2026-02-02T01:00:00.000Z",
  );
  expect(assertRunReceiptPolicyJoin(run, activeProject())).toBe(run);
});

test("a run started after new terms took effect cannot acknowledge the old terms", () => {
  const run = receipt(
    ACK_A,
    "2026-02-02T00:00:00.000Z",
    "2026-02-02T01:00:00.000Z",
  );
  expect(() => assertRunReceiptPolicyJoin(run, activeProject())).toThrow(
    "run receipt policy acknowledgement does not match the pinned project policy",
  );
});

test("a run started exactly when new terms took effect is under the new terms", () => {
  const run = receipt(ACK_A, REV_B_AT, "2026-02-01T01:00:00.000Z");
  expect(() => assertRunReceiptPolicyJoin(run, activeProject())).toThrow(
    "run receipt policy acknowledgement does not match the pinned project policy",
  );
});

test("a run started before activation still fails", () => {
  const run = receipt(
    ACK_A,
    "2025-12-31T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  );
  expect(() => assertRunReceiptPolicyJoin(run, activeProject())).toThrow(
    "v2 run receipt started before project policy activation",
  );
});

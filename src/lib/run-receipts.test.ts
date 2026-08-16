/** Exercises strict project-run marker validation and adversarial failures. */

import { describe, expect, it } from "vitest";
import { findProject } from "./projects.mjs";
import {
  assertRunReceiptMarker,
  assertRunReceiptPolicyJoin,
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
    marker.run.repository = "elizaOS/proximityprize";
    expect(() => assertRunReceiptMarker(marker)).toThrow(
      /does not belong to the project/u,
    );
  });

  it("accepts any concrete declared provider, model, and client", () => {
    const marker = runReceiptMarker(receipt);
    marker.provider = "x-ai/hosted+edge";
    marker.model = "accounts/x/models/grok-4.5+reasoning";
    marker.client = "grok-build+acp";
    expect(assertRunReceiptMarker(marker)).toMatchObject({
      provider: "x-ai/hosted+edge",
      model: "accounts/x/models/grok-4.5+reasoning",
      client: "grok-build+acp",
    });

    marker.model = "N/A";
    expect(() => assertRunReceiptMarker(marker)).toThrow(/non-placeholder/u);
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

  it("binds new receipts to the exact policy acknowledgement", () => {
    const current: ProjectRunReceipt = {
      ...receipt,
      schemaVersion: "2",
      startedAt: "2026-08-16T00:00:00.000Z",
      completedAt: "2026-08-16T01:00:00.000Z",
      policyAcknowledgement: {
        policyRevision: "2026-08-16.1",
        licenseSha256:
          "d0590837a439c742e89c8226137dd4e902fa1e0df486347dbfc9b8ba68b5826d",
        inboundTermsSha256: null,
        prizeRulesSha256: null,
        acknowledgedAt: "2026-08-16T00:00:00.000Z",
      },
    };
    expect(parseRunMarker(serializeRunMarker(current))).toEqual(current);

    const missing = runReceiptMarker(current);
    delete missing.run.policy_acknowledgement;
    expect(() => assertRunReceiptMarker(missing)).toThrow(/schema/u);
  });

  it("rejects policy acknowledgement outside the signed run interval", () => {
    const current: ProjectRunReceipt = {
      ...receipt,
      schemaVersion: "2",
      policyAcknowledgement: {
        policyRevision: "policy-2",
        licenseSha256: "a".repeat(64),
        inboundTermsSha256: null,
        prizeRulesSha256: null,
        acknowledgedAt: "2026-08-07T09:59:59.999Z",
      },
    };
    expect(() => assertRunReceiptMarker(runReceiptMarker(current))).toThrow(
      /within the run/u,
    );
    const acknowledgement = current.policyAcknowledgement;
    if (!acknowledgement) throw new Error("test receipt lacks acknowledgement");
    acknowledgement.acknowledgedAt = "2026-08-07T11:00:00.001Z";
    expect(() => assertRunReceiptMarker(runReceiptMarker(current))).toThrow(
      /within the run/u,
    );
  });

  it("keeps historical v2 receipts pinned after policy changes", () => {
    const historical: ProjectRunReceipt = {
      ...receipt,
      schemaVersion: "2",
      startedAt: "2026-08-15T00:00:00.000Z",
      completedAt: "2026-08-15T01:00:00.000Z",
      policyAcknowledgement: {
        policyRevision: "historical-policy-1",
        licenseSha256: "a".repeat(64),
        inboundTermsSha256: "b".repeat(64),
        prizeRulesSha256: null,
        acknowledgedAt: "2026-08-15T00:00:00.000Z",
      },
    };
    expect(parseRunMarker(serializeRunMarker(historical))).toEqual(historical);
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

  it("uses immutable authority activation as the non-retroactive v1 cutover", () => {
    const pendingProject = findProject("eliza");
    if (!pendingProject) throw new Error("missing fixture project");
    expect(assertRunReceiptPolicyJoin(receipt, pendingProject)).toBe(receipt);
    const project = {
      ...pendingProject,
      terms: {
        ...pendingProject.terms,
        receiptPolicy: {
          state: "active" as const,
          activatedAt: "2026-08-16T12:00:00.000Z",
          bindings: [
            {
              policyRevision: pendingProject.terms.revision,
              licenseSha256: pendingProject.terms.repositoryLicense.fileSha256!,
              inboundTermsSha256: pendingProject.terms.inbound.fileSha256,
              prizeRulesSha256:
                pendingProject.terms.externalPrize?.rulesSha256 ?? null,
              activatedAt: "2026-08-16T12:00:00.000Z",
            },
          ],
        },
      },
    };
    expect(assertRunReceiptPolicyJoin(receipt, project)).toBe(receipt);
    const afterCutover = {
      ...receipt,
      startedAt: "2026-08-16T12:00:00.000Z",
      completedAt: "2026-08-16T13:00:00.000Z",
    };
    expect(() => assertRunReceiptPolicyJoin(afterCutover, project)).toThrow(
      /not allowed after/u,
    );
  });

  it("rejects arbitrary v2 terms digests at the pinned-policy join", () => {
    const pendingProject = findProject("eliza");
    if (!pendingProject) throw new Error("missing fixture project");
    const project = {
      ...pendingProject,
      terms: {
        ...pendingProject.terms,
        receiptPolicy: {
          state: "active" as const,
          activatedAt: "2026-08-16T12:00:00.000Z",
          bindings: [
            {
              policyRevision: pendingProject.terms.revision,
              licenseSha256: pendingProject.terms.repositoryLicense.fileSha256!,
              inboundTermsSha256: pendingProject.terms.inbound.fileSha256,
              prizeRulesSha256:
                pendingProject.terms.externalPrize?.rulesSha256 ?? null,
              activatedAt: "2026-08-16T12:00:00.000Z",
            },
          ],
        },
      },
    };
    const licenseSha256 = project.terms.repositoryLicense.fileSha256;
    if (!licenseSha256) throw new Error("test project lacks a license digest");
    const current: ProjectRunReceipt = {
      ...receipt,
      schemaVersion: "2",
      startedAt: "2026-08-16T12:00:00.000Z",
      completedAt: "2026-08-16T13:00:00.000Z",
      policyAcknowledgement: {
        policyRevision: project.terms.revision,
        licenseSha256,
        inboundTermsSha256: project.terms.inbound.fileSha256,
        prizeRulesSha256: project.terms.externalPrize?.rulesSha256 ?? null,
        acknowledgedAt: "2026-08-16T12:00:00.000Z",
      },
    };
    expect(assertRunReceiptPolicyJoin(current, project)).toBe(current);
    const acknowledgement = current.policyAcknowledgement;
    if (!acknowledgement) throw new Error("test receipt lacks acknowledgement");
    acknowledgement.licenseSha256 = "f".repeat(64);
    expect(() => assertRunReceiptPolicyJoin(current, project)).toThrow(
      /pinned project policy/u,
    );
  });
});

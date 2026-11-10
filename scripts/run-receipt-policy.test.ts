import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertRunReceiptMarker } from "../src/lib/run-receipts";

// The policy acknowledgement records the project status it was issued under,
// so a paused project's receipt can never be read as proof the project was
// open. The skill-side marker and the ingestion-side validator must agree on
// the field; receipts minted before it existed omit it and stay valid.
//
// run-receipt.mjs reads project.json at import time, so the marker is tested
// against a copy of the skill scripts with a fixture project.json, the same
// way the installer tests exercise an installed skill.
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillCopy = mkdtempSync(join(tmpdir(), "slop-run-receipt-policy-"));
cpSync(
  join(repositoryRoot, "skills/project-contributor-template/scripts"),
  join(skillCopy, "scripts"),
  { recursive: true },
);
writeFileSync(
  join(skillCopy, "project.json"),
  JSON.stringify({
    projectId: "thenetwork",
    repositoryId: "eliza-research/thenetwork",
    skillSourcePath: "skills/project-contributor-template",
    usageAdapters: {},
  }),
);
const {
  marker,
}: {
  marker(receipt: Record<string, unknown>): Record<string, unknown>;
} = await import(
  pathToFileURL(join(skillCopy, "scripts", "run-receipt.mjs")).href
);
afterAll(() => {
  rmSync(skillCopy, { recursive: true, force: true });
});

const SHA = "a".repeat(64);
const RUN_ID = `run_${"A".repeat(26)}`;

function receipt(acknowledgement: Record<string, unknown> | undefined) {
  return {
    schemaVersion: "2",
    runId: RUN_ID,
    projectId: "thenetwork",
    repositoryId: "eliza-research/thenetwork",
    startedAt: "2026-11-08T12:00:00.000Z",
    completedAt: "2026-11-08T12:05:00.000Z",
    provider: "fixture",
    model: "fixture-model",
    client: "codex",
    // The frozen fixture registry (tests/registry-preload.ts) keeps the
    // legacy per-project skill path for thenetwork.
    skillRevision: `SlopDotCash/slopdotcash@${"a".repeat(40)}:skills/contribute-to-thenetwork`,
    skillSha256: SHA,
    ...(acknowledgement === undefined
      ? {}
      : { policyAcknowledgement: acknowledgement }),
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
    devicePublicKey: "A".repeat(43),
    deviceKeyId: SHA,
    deviceSignature: "A".repeat(86),
  };
}

function acknowledgement(status: string | undefined) {
  return {
    policyRevision: "draft-1",
    ...(status === undefined ? {} : { status }),
    licenseSha256: null,
    inboundTermsSha256: null,
    prizeRulesSha256: null,
    acknowledgedAt: "2026-11-08T12:01:00.000Z",
  };
}

test("a paused project's receipt marker records its status", () => {
  const marked = marker(receipt(acknowledgement("paused"))) as {
    run: { policy_acknowledgement: Record<string, unknown> };
  };
  expect(marked.run.policy_acknowledgement.project_status).toBe("paused");
  expect(assertRunReceiptMarker(marked).policyAcknowledgement?.status).toBe(
    "paused",
  );
});

test("an active project's receipt marker records its status", () => {
  const marked = marker(receipt(acknowledgement("active"))) as {
    run: { policy_acknowledgement: Record<string, unknown> };
  };
  expect(marked.run.policy_acknowledgement.project_status).toBe("active");
  expect(assertRunReceiptMarker(marked).policyAcknowledgement?.status).toBe(
    "active",
  );
});

test("a receipt minted before the status record stays valid without it", () => {
  const marked = marker(receipt(acknowledgement(undefined))) as {
    run: { policy_acknowledgement: Record<string, unknown> };
  };
  expect(
    Object.hasOwn(marked.run.policy_acknowledgement, "project_status"),
  ).toBe(false);
  expect(assertRunReceiptMarker(marked).policyAcknowledgement).toMatchObject({
    policyRevision: "draft-1",
  });
  expect(
    assertRunReceiptMarker(marked).policyAcknowledgement?.status,
  ).toBeUndefined();
});

test("a marker with an unknown project status is refused", () => {
  const marked = marker(receipt(acknowledgement("active"))) as {
    run: { policy_acknowledgement: Record<string, unknown> };
  };
  marked.run.policy_acknowledgement.project_status = "retired";
  expect(() => assertRunReceiptMarker(marked)).toThrow(
    "project_status is invalid",
  );
});

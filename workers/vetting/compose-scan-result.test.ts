import { expect, test } from "bun:test";
import type { VettingArtifact } from "../../backend/vetting/result";
import {
  parseRecordedVettingResult,
  SCAN_SURFACES,
  SCAN_THREATS,
} from "../../backend/vetting/scan-result";
import { sha256Hex } from "../../src/lib/sha256";
import {
  composeScanResult,
  type RepositoryInspection,
  type ScanFinding,
} from "./bounded-scan";
import { SCAN_REVIEW_AREAS, type ScannerEvidence } from "./scanners";

const hex64 = "a".repeat(64);
const sha40 = "b".repeat(40);

function inspection(input: {
  gaps: number;
  findings: number;
  locks: number;
  artifacts: number;
}): RepositoryInspection {
  const inventory = new TextEncoder().encode(
    JSON.stringify({ schemaVersion: "slop-scan-inventory-v2", items: [] }),
  );
  const findings: ScanFinding[] = Array.from(
    { length: input.findings },
    (_, index) => ({
      path: "install.sh",
      severity: "low",
      category: "other",
      summary: `synthetic low finding ${index}`,
      evidence: `evidence ${index}`,
    }),
  );
  const artifacts: VettingArtifact[] = Array.from(
    { length: input.artifacts },
    (_, index) => ({
      sha256: sha256Hex(`artifact-${index}`),
      parentSha256: null,
      origin: "repository",
      path: `bin/artifact-${index}`,
      type: "binary",
      state: "quarantined",
      analysis: "pending",
      requestedExecution: false,
    }),
  );
  return {
    inventory,
    inventorySha256: sha256Hex(inventory),
    coverage: Object.fromEntries(
      SCAN_SURFACES.map((surface) => [
        surface,
        { state: "complete", items: 0 },
      ]),
    ) as RepositoryInspection["coverage"],
    checks: Object.fromEntries(
      SCAN_THREATS.map((threat) => [threat, "passed"]),
    ) as RepositoryInspection["checks"],
    findings,
    artifacts,
    dependencyLocks: Array.from({ length: input.locks }, (_, index) => ({
      path: `packages/p${index}/package-lock.json`,
      sha256: sha256Hex(`lock-${index}`),
    })),
    visibilityGaps: Array.from(
      { length: input.gaps },
      (_, index) =>
        `Install-time download not retrieved: https://example.invalid/dl-${index}.sh`,
    ),
    downloads: Array.from(
      { length: input.gaps },
      (_, index) => `https://example.invalid/dl-${index}.sh`,
    ),
    deterministic: [],
    riskSignals: [],
  };
}

function primary(inventorySha256: string): ScannerEvidence {
  return {
    review: {
      reviewer: "opus",
      provider: "surplus",
      model: "claude-sonnet-5.5",
      promptPolicyRevision: "test",
      inputManifestSha256: inventorySha256,
      runId: "run-test",
      status: "completed",
      verdict: "no-findings",
      findingCount: 0,
    },
    promptSha256: hex64,
    responseSha256: hex64,
    providerRequestId: null,
    returnedModel: null,
    coverage: Object.fromEntries(
      SCAN_REVIEW_AREAS.map((area) => [area, "complete"]),
    ) as ScannerEvidence["coverage"],
    confidence: 1,
    findings: [],
    usage: null,
    cost: null,
    visibilityGaps: [],
  };
}

function compose(input: {
  gaps: number;
  findings: number;
  locks: number;
  artifacts: number;
}) {
  const found = inspection(input);
  return composeScanResult({
    queued: {
      assessmentId: `vet_${"c".repeat(32)}`,
      projectId: "test-proj",
      revision: 1,
      manifestSha256: hex64,
      repository: "owner/repo",
      commitSha: sha40,
      templateSha256: hex64,
    },
    inspection: found,
    policyVersion: "test-policy",
    runId: "scan_test",
    startedAt: "2026-11-10T00:00:00.000Z",
    completedAt: "2026-11-10T00:01:00.000Z",
    primary: primary(found.inventorySha256),
  }).result;
}

test("composed gaps stay within the intake parser limit when findings overflow", () => {
  const result = compose({ gaps: 55, findings: 201, locks: 0, artifacts: 0 });
  expect(result.visibilityGaps.length).toBe(50);
  expect(result.visibilityGaps).toContain("More than 200 scan findings");
  expect(result.disposition).toBe("incomplete");
  expect(() =>
    parseRecordedVettingResult(JSON.parse(JSON.stringify(result))),
  ).not.toThrow();
});

test("composed gaps stay within the limit when locks overflow", () => {
  const result = compose({ gaps: 50, findings: 0, locks: 201, artifacts: 0 });
  expect(result.visibilityGaps.length).toBe(50);
  expect(result.visibilityGaps).toContain("More than 200 dependency locks");
  expect(() =>
    parseRecordedVettingResult(JSON.parse(JSON.stringify(result))),
  ).not.toThrow();
});

test("composed gaps stay within the limit when artifacts overflow", () => {
  const result = compose({ gaps: 50, findings: 0, locks: 0, artifacts: 501 });
  expect(result.visibilityGaps.length).toBe(50);
  expect(result.visibilityGaps).toContain("More than 500 scan artifacts");
  expect(() =>
    parseRecordedVettingResult(JSON.parse(JSON.stringify(result))),
  ).not.toThrow();
});

test("a small gap list still carries its truncation note", () => {
  const result = compose({ gaps: 10, findings: 201, locks: 0, artifacts: 0 });
  expect(result.visibilityGaps.length).toBe(11);
  expect(result.visibilityGaps).toContain("More than 200 scan findings");
  expect(() =>
    parseRecordedVettingResult(JSON.parse(JSON.stringify(result))),
  ).not.toThrow();
});

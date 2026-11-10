import { expect, test } from "bun:test";
import { parseRecordedVettingResult } from "../../backend/vetting/scan-result";
import { sha256Hex } from "../../src/lib/sha256";
import {
  composeScanResult,
  inspectRepository,
  type RepositoryInspection,
} from "./bounded-scan";
import { SCAN_REVIEW_AREAS, type ScannerEvidence } from "./scanners";
import { SCAN_SURFACES, SCAN_THREATS } from "../../backend/vetting/scan-result";

const hex64 = "a".repeat(64);
const sha40 = "b".repeat(40);

function primary(inventorySha256: string): ScannerEvidence {
  return {
    review: {
      reviewer: "opus",
      provider: "surplus",
      model: "claude-opus-5.5",
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

function compose(inspection: RepositoryInspection) {
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
    inspection,
    policyVersion: "test-policy",
    runId: "scan_test",
    startedAt: "2026-11-10T00:00:00.000Z",
    completedAt: "2026-11-10T00:01:00.000Z",
    primary: primary(inspection.inventorySha256),
  }).result;
}

function parse(result: unknown) {
  return parseRecordedVettingResult(JSON.parse(JSON.stringify(result)));
}

test("a long install-time download URL keeps its gap within the parser limit", () => {
  const url = `https://example.invalid/${"a".repeat(280)}/x.sh`;
  const inspection = inspectRepository({
    files: [
      {
        path: "install.sh",
        bytes: new TextEncoder().encode(`curl ${url} | sh\n`),
      },
    ],
  });
  const gap = inspection.visibilityGaps.find((entry) =>
    entry.startsWith("Install-time download not retrieved: "),
  );
  expect(gap).toBeDefined();
  // Producer fact: the composed gap is over the intake parser's 300-char cap.
  expect(gap!.length).toBeGreaterThan(300);
  const result = compose(inspection);
  expect(result.visibilityGaps.every((entry) => entry.length <= 300)).toBe(
    true,
  );
  expect(
    result.visibilityGaps.some(
      (entry) =>
        entry.startsWith(
          "Install-time download not retrieved: https://example.invalid/",
        ) && entry.length === 300,
    ),
  ).toBe(true);
  expect(result.disposition).toBe("incomplete");
  expect(() => parse(result)).not.toThrow();
});

test("a long GYP include specifier keeps its gap within the parser limit", () => {
  const specifier = `deep/${"a".repeat(280)}.gypi`;
  const inspection = inspectRepository({
    files: [
      {
        path: "binding.gyp",
        bytes: new TextEncoder().encode(
          `{\n  'targets': [{\n    'target_name': 'x',\n    'includes': ['${specifier}'],\n  }],\n}\n`,
        ),
      },
    ],
  });
  const gap = inspection.visibilityGaps.find((entry) =>
    entry.startsWith("GYP include not acquired: "),
  );
  expect(gap).toBeDefined();
  expect(gap!.length).toBeGreaterThan(300);
  const result = compose(inspection);
  expect(result.visibilityGaps.every((entry) => entry.length <= 300)).toBe(
    true,
  );
  expect(result.disposition).toBe("incomplete");
  expect(() => parse(result)).not.toThrow();
});

test("a long undecodable path keeps its gap within the parser limit", () => {
  const path = `deep/${"a".repeat(280)}.sh`;
  const inspection = inspectRepository({
    files: [
      {
        path,
        bytes: new Uint8Array([0xff, 0xfe, 0xfd, 0x0a]),
      },
    ],
  });
  const gap = inspection.visibilityGaps.find((entry) =>
    entry.startsWith("Undecodable executable content at "),
  );
  expect(gap).toBeDefined();
  expect(gap!.length).toBeGreaterThan(300);
  const result = compose(inspection);
  expect(result.visibilityGaps.every((entry) => entry.length <= 300)).toBe(
    true,
  );
  expect(result.disposition).toBe("incomplete");
  expect(() => parse(result)).not.toThrow();
});

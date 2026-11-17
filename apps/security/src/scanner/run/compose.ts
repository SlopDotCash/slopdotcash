// spec/security/admission.md, "Synthesis decides the repository result and confirmed malice needs trusted evidence"; spec/security/admission.md, "Acquisition binds one shallow fetch of the exact commit"
import { sha256Of } from "@repo/platform/git/bytes";
import { type Execution, type ScanResult, type ScanReview, resultProblems, scanSchema, specialistRequired } from "../../admission/result.ts";
import { refusalInventory } from "../inspect/inspection.ts";
import { SCAN_SURFACES, SCAN_THREATS, type RepositoryInspection } from "../inspect/model.ts";
import { SCAN_PROMPT_REVISION, SCAN_REVIEW_AREAS, type ScannerEvidence } from "../providers/review.ts";

export interface QueuedScan {
  readonly assessmentId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly commitSha: string;
  readonly templateSha256: string;
  readonly repository: string;
}

export interface Composed {
  readonly result: ScanResult;
  readonly report: Uint8Array;
  readonly inventory: Uint8Array;
}

const encoder = new TextEncoder();

/** @throws {never} */
export function scanReview(evidence: ScannerEvidence): ScanReview {
  const completed = evidence.review.status === "completed";
  const risk = !completed
    ? null
    : evidence.review.verdict === "malicious-suspected" || evidence.findings.some((finding) => finding.severity === "high" || finding.severity === "critical")
      ? "high"
      : evidence.review.verdict === "findings" || evidence.coverage === null || SCAN_REVIEW_AREAS.some((area) => evidence.coverage?.[area] !== "complete")
        ? "ambiguous"
        : "low";
  return {
    provider: evidence.review.provider,
    model: evidence.review.model,
    promptPolicyRevision: evidence.review.promptPolicyRevision,
    inputManifestSha256: evidence.review.inputManifestSha256,
    runId: evidence.review.runId,
    status: evidence.review.status,
    verdict: completed ? evidence.review.verdict : null,
    risk,
    findingCount: evidence.review.findingCount,
  };
}

/** @throws {never} */
export function composeAcquisitionRefusal(input: { readonly queued: QueuedScan; readonly reason: string; readonly primaryModel: string; readonly policyVersion: string; readonly runId: string; readonly startedAt: string; readonly completedAt: string }): Composed {
  const { inventory, inventorySha256, visibilityGaps } = refusalInventory(input.reason);
  const report = encoder.encode(
    JSON.stringify({ schemaVersion: "slop-scan-acquisition-refusal-v1", assessmentId: input.queued.assessmentId, reason: input.reason, acquiredFilesInspected: 0, modelReviewStarted: false, inventorySha256 }),
  );
  const result: ScanResult = {
    schemaVersion: scanSchema,
    assessmentId: input.queued.assessmentId,
    projectId: input.queued.projectId,
    revision: input.queued.revision,
    manifestSha256: input.queued.manifestSha256,
    disposition: "incomplete",
    policyVersion: input.policyVersion,
    assessed: { repository: input.queued.repository, commitSha: input.queued.commitSha, templateSha256: input.queued.templateSha256, inputManifestSha256: inventorySha256, dependencyLocks: [] },
    scan: { runId: input.runId, startedAt: input.startedAt, completedAt: input.completedAt, reportSha256: sha256Of(report) },
    coverage: Object.fromEntries(SCAN_SURFACES.map((surface) => [surface, { state: "unsupported", items: 0 }])) as ScanResult["coverage"],
    checks: Object.fromEntries(SCAN_THREATS.map((threat) => [threat, "not-run"])) as ScanResult["checks"],
    visibilityGaps: [...visibilityGaps],
    execution: null,
    reusedAssessmentId: null,
    primaryReview: {
      provider: "surplus",
      model: input.primaryModel,
      promptPolicyRevision: SCAN_PROMPT_REVISION,
      inputManifestSha256: inventorySha256,
      runId: `not-started-${input.runId}`,
      status: "not-started",
      verdict: null,
      risk: null,
      findingCount: 0,
    },
    specialistReview: null,
    artifacts: [],
    findings: [],
    confirmation: null,
  };
  return { result, report, inventory };
}

export interface ScanComposition {
  readonly result: ScanResult;
  readonly report: Uint8Array;
  readonly needsSpecialist: boolean;
}

export class ReviewInventoryMismatch extends Error {
  override readonly name = "ReviewInventoryMismatch";
}

/** @throws {ReviewInventoryMismatch} */
export function composeScanResult(input: {
  readonly queued: QueuedScan;
  readonly inspection: RepositoryInspection;
  readonly policyVersion: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly primary: ScannerEvidence;
  readonly specialist: ScannerEvidence | null;
  readonly execution: Execution | null;
  readonly executionEvidenceSha256s: ReadonlyArray<string>;
  readonly sourceInventorySha256: string;
}): ScanComposition {
  const { inspection } = input;
  for (const scanner of [input.primary, input.specialist]) if (scanner !== null && scanner.review.inputManifestSha256 !== inspection.inventorySha256) throw new ReviewInventoryMismatch("A review read another inventory");
  const truncationNotes = [
    ...(inspection.dependencyLocks.length > 200 ? ["More than 200 dependency locks"] : []),
    ...(inspection.findings.length > 200 ? ["More than 200 scan findings"] : []),
    ...(inspection.artifacts.length > 500 ? ["More than 500 scan artifacts"] : []),
  ];
  const report = encoder.encode(
    JSON.stringify({
      schemaVersion: "slop-scan-report-v2",
      assessmentId: input.queued.assessmentId,
      sourceInventorySha256: input.sourceInventorySha256,
      inventorySha256: inspection.inventorySha256,
      findings: inspection.findings,
      downloads: inspection.downloads,
      execution: input.execution,
      executionEvidenceSha256s: input.executionEvidenceSha256s,
      visibilityGaps: inspection.visibilityGaps,
      reviews: [input.primary, ...(input.specialist === null ? [] : [input.specialist])],
    }),
  );
  const composed: ScanResult = {
    schemaVersion: scanSchema,
    assessmentId: input.queued.assessmentId,
    projectId: input.queued.projectId,
    revision: input.queued.revision,
    manifestSha256: input.queued.manifestSha256,
    disposition: "clean",
    policyVersion: input.policyVersion,
    assessed: {
      repository: input.queued.repository,
      commitSha: input.queued.commitSha,
      templateSha256: input.queued.templateSha256,
      inputManifestSha256: inspection.inventorySha256,
      sourceInventorySha256: input.sourceInventorySha256,
      dependencyLocks: inspection.dependencyLocks.slice(0, 200),
    },
    scan: { runId: input.runId, startedAt: input.startedAt, completedAt: input.completedAt, reportSha256: sha256Of(report) },
    coverage: inspection.coverage,
    checks: inspection.checks,
    visibilityGaps: [...[...new Set([...inspection.visibilityGaps, ...input.primary.visibilityGaps, ...(input.specialist?.visibilityGaps ?? [])])].slice(0, 50 - truncationNotes.length), ...truncationNotes],
    execution: input.execution,
    reusedAssessmentId: null,
    primaryReview: scanReview(input.primary),
    specialistReview: input.specialist === null ? null : scanReview(input.specialist),
    artifacts: inspection.artifacts.slice(0, 500),
    findings: inspection.findings.slice(0, 200).map(({ path: _path, ...finding }) => finding),
    confirmation: null,
  };
  const result: ScanResult = resultProblems(composed).length > 0 ? { ...composed, disposition: "incomplete" } : composed;
  return { result, report, needsSpecialist: input.specialist === null && specialistRequired(result) };
}

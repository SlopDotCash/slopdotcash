// spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
import { type RecordedResult, type ScanResult, type ScanReview, advisoryReviewGap, isScanResult, resultReviewers, scanSurfaces, scanThreats, specialistRequired, templatePrefix } from "./result.ts";

export type AssessmentState = "pending" | "clean" | "incomplete" | "malicious";
export type FindingsLocation = "repository" | "template" | "both" | "unknown";

export interface ReviewOutcome {
  readonly status: ScanReview["status"];
  readonly verdict: ScanReview["verdict"];
  readonly risk: ScanReview["risk"];
}

export interface ClearanceFacts {
  readonly flaggedChecks: ReadonlyArray<string>;
  readonly checksNotRun: ReadonlyArray<string>;
  readonly incompleteSurfaces: ReadonlyArray<{ readonly surface: string; readonly state: "partial" | "unsupported" }>;
  readonly visibilityGaps: ReadonlyArray<string>;
  readonly openFindings: ReadonlyArray<{ readonly category: string; readonly count: number }>;
  readonly review: { readonly primary: ReviewOutcome; readonly specialist: ReviewOutcome | null; readonly escalated: boolean };
}

export interface AssessmentFacts {
  readonly id: string;
  readonly revision: number;
  readonly state: AssessmentState;
  readonly commitSha: string;
  readonly templateSha256: string;
  readonly policyVersion: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly result: RecordedResult | undefined;
}

export interface Summary {
  readonly id: string;
  readonly revision: number;
  readonly state: AssessmentState;
  readonly commitSha: string;
  readonly templateSha256: string;
  readonly policyVersion: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly modelRuns: ReadonlyArray<{ readonly reviewer: string; readonly provider: string; readonly model: string }>;
  readonly artifacts: number;
  readonly heldArtifacts: number;
  readonly findingsLocation?: FindingsLocation;
  readonly scan?: ClearanceFacts;
}

const evidencePath = /^([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)(?::\d+(?::\d+)?)?$/u;

function pathOf(evidence: string): string | null {
  return evidencePath.exec(evidence.trim())?.[1] ?? null;
}

function isTemplatePath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/^\.\//u, "");
  return normalized === templatePrefix || normalized.startsWith(`${templatePrefix}/`);
}

/** @throws {never} */
export function findingsLocationOf(result: RecordedResult | undefined): FindingsLocation | undefined {
  if (result === undefined) return undefined;
  const held = result.artifacts.filter((artifact) => artifact.state !== "released");
  let template = held.some((artifact) => isTemplatePath(artifact.path));
  let repository = held.some((artifact) => !isTemplatePath(artifact.path));
  let unknown = false;
  for (const finding of result.findings) {
    const path = pathOf(finding.evidence);
    if (path === null) unknown = true;
    else if (isTemplatePath(path)) template = true;
    else repository = true;
  }
  if (unknown) return "unknown";
  if (template && repository) return "both";
  if (template) return "template";
  if (repository) return "repository";
  return undefined;
}

function outcomeOf(review: ScanReview): ReviewOutcome {
  return { status: review.status, verdict: review.verdict, risk: review.risk };
}

/** @throws {never} */
export function clearanceFactsOf(result: ScanResult): ClearanceFacts {
  const open = new Map<string, number>();
  for (const finding of result.findings) if (finding.severity === "high" || finding.severity === "critical") open.set(finding.category, (open.get(finding.category) ?? 0) + 1);
  return {
    flaggedChecks: scanThreats.filter((threat) => result.checks[threat] === "flagged"),
    checksNotRun: scanThreats.filter((threat) => result.checks[threat] === "not-run"),
    incompleteSurfaces: scanSurfaces.flatMap((surface) => {
      const state = result.coverage[surface].state;
      return state === "partial" || state === "unsupported" ? [{ surface, state }] : [];
    }),
    visibilityGaps: [...new Set(result.visibilityGaps)],
    openFindings: [...open].map(([category, found]) => ({ category, count: found })),
    review: { primary: outcomeOf(result.primaryReview), specialist: result.specialistReview === null ? null : outcomeOf(result.specialistReview), escalated: specialistRequired(result) },
  };
}

/** @throws {never} */
export function summarize(assessment: AssessmentFacts): Summary {
  const result = assessment.result;
  const artifacts = result?.artifacts ?? [];
  const location = findingsLocationOf(result);
  return {
    id: assessment.id,
    revision: assessment.revision,
    state: assessment.state,
    commitSha: assessment.commitSha,
    templateSha256: assessment.templateSha256,
    policyVersion: assessment.policyVersion,
    requestedAt: assessment.requestedAt,
    completedAt: assessment.completedAt,
    modelRuns: result === undefined ? [] : resultReviewers(result),
    artifacts: artifacts.length,
    heldArtifacts: artifacts.filter((artifact) => artifact.state !== "released").length,
    ...(location === undefined ? {} : { findingsLocation: location }),
    ...(result !== undefined && isScanResult(result) ? { scan: clearanceFactsOf(result) } : {}),
  };
}

/** @throws {never} */
export function quarantinedScanMessage(completedAt: string | null, result: RecordedResult | undefined): string {
  if (completedAt === null || result === undefined) return "The last scan could not finish, so it did not clear the project.";
  const location = findingsLocationOf(result);
  if (location === "template") return "Findings in Slop's skill template block clearance.";
  if (location === "repository") return "Findings in the project repository block clearance.";
  if (location === "both") return "Findings in both the repository and skill template block clearance.";
  if (location === "unknown") return "Findings block clearance.";
  if (isScanResult(result) && result.primaryReview.status === "completed"
    && (result.specialistReview?.status === "completed" || (result.specialistReview === null && !specialistRequired(result)))
    && scanThreats.every((threat) => result.checks[threat] !== "not-run")
    && scanSurfaces.every((surface) => result.coverage[surface].state === "complete")
    && result.visibilityGaps.every(advisoryReviewGap)) {
    return "The last scan finished, but it did not establish clearance.";
  }
  return "The last scan could not finish, so it did not clear the project.";
}

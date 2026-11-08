/** The actual persisted header fields used before a retained result is read. */
export interface ReuseAssessmentHeader {
  id: string;
  projectId: string;
  state: string;
  requestedAt: string;
}

export type ReuseCachedAssessment =
  | { kind: "missing" }
  | { kind: "present"; assessment: ReuseAssessmentHeader };

export type ReuseRestrictionBoundary =
  | { kind: "none" }
  | { kind: "record"; actorRole: string; createdAt: string };

export interface ReuseRestriction {
  state: string;
  boundary: ReuseRestrictionBoundary;
}

/** SQL flag coverage remains a caller-supplied observation, not authority. */
//@ verify
//@ pure
//@ ensures \result ==> coversActiveFlags && disposition == "clean" && cached.kind == "present"
//@ ensures \result ==> cached.assessment.id == citedAssessmentId && cached.assessment.projectId == projectId && cached.assessment.state == "clean"
//@ ensures restriction.state == "quarantined" && restriction.boundary.kind == "record" && restriction.boundary.actorRole == "contributor-flags" ==> !\result
//@ ensures \result && restriction.state != "clear" && restriction.boundary.kind == "record" && restriction.boundary.actorRole == "vetting-service" ==> cached.assessment.requestedAt > restriction.boundary.createdAt
//@ ensures \result && restriction.state != "clear" && restriction.boundary.kind == "record" && restriction.boundary.actorRole != "vetting-service" ==> cached.assessment.requestedAt >= restriction.boundary.createdAt
//@ ensures \result <==> coversActiveFlags && disposition == "clean" && cached.kind == "present" && cached.assessment.id == citedAssessmentId && cached.assessment.projectId == projectId && cached.assessment.state == "clean" && !(restriction.state == "quarantined" && restriction.boundary.kind == "record" && restriction.boundary.actorRole == "contributor-flags") && (restriction.state == "clear" || restriction.boundary.kind == "none" || (restriction.boundary.actorRole == "vetting-service" ? cached.assessment.requestedAt > restriction.boundary.createdAt : cached.assessment.requestedAt >= restriction.boundary.createdAt))
export function reusableAssessmentHeader(
  cached: ReuseCachedAssessment,
  citedAssessmentId: string | null,
  projectId: string,
  disposition: string,
  restriction: ReuseRestriction,
  coversActiveFlags: boolean,
): boolean {
  if (
    restriction.state === "quarantined" &&
    restriction.boundary.kind === "record" &&
    restriction.boundary.actorRole === "contributor-flags"
  )
    return false;
  if (
    !coversActiveFlags ||
    disposition !== "clean" ||
    cached.kind === "missing"
  )
    return false;
  if (
    cached.assessment.id !== citedAssessmentId ||
    cached.assessment.projectId !== projectId ||
    cached.assessment.state !== "clean"
  )
    return false;
  if (restriction.state === "clear" || restriction.boundary.kind === "none")
    return true;
  return restriction.boundary.actorRole === "vetting-service"
    ? cached.assessment.requestedAt > restriction.boundary.createdAt
    : cached.assessment.requestedAt >= restriction.boundary.createdAt;
}

/** A reuse may cite a clean original scan, never a different project or reuse. */
//@ verify
//@ pure
//@ ensures \result <==> priorProjectId == projectId && priorDisposition == "clean" && priorCitedAssessmentId == null
export function originalScanHeader(
  priorProjectId: string,
  priorDisposition: string,
  priorCitedAssessmentId: string | null,
  projectId: string,
): boolean {
  return (
    priorProjectId === projectId &&
    priorDisposition === "clean" &&
    priorCitedAssessmentId === null
  );
}

/** Original nested records remain lazy; only execution presence is projected. */
export interface ReuseScanEvidence {
  assessed: {
    inputManifestSha256: string;
    sourceInventorySha256?: string;
    templateSha256: string;
  };
  hasExecution: boolean;
  artifacts: { sha256: string }[];
  policyVersion: string;
  scan: { runId: string; reportSha256: string };
}

/** Explicit acquisition binding wins; only text-only legacy scans can fall back. */
//@ verify
//@ pure
//@ ensures result.assessed.sourceInventorySha256 != null ==> \result == result.assessed.sourceInventorySha256
//@ ensures result.assessed.sourceInventorySha256 == null && !result.hasExecution && result.artifacts.length == 0 ==> \result == result.assessed.inputManifestSha256
//@ ensures result.assessed.sourceInventorySha256 == null && (result.hasExecution || result.artifacts.length != 0) ==> \result == null
export function reusableSourceInventory(
  result: ReuseScanEvidence,
): string | null {
  return (
    result.assessed.sourceInventorySha256 ??
    (!result.hasExecution && result.artifacts.length === 0
      ? result.assessed.inputManifestSha256
      : null)
  );
}

/** Repository arguments retain the caller's native Unicode case folding. */
//@ verify
//@ pure
//@ ensures \result <==> priorRepository == candidateRepository && prior.assessed.inputManifestSha256 == candidate.assessed.inputManifestSha256 && reusableSourceInventory(prior) != null && reusableSourceInventory(prior) == reusableSourceInventory(candidate) && prior.assessed.templateSha256 == candidate.assessed.templateSha256 && prior.policyVersion == candidate.policyVersion && prior.scan.runId == candidate.scan.runId && prior.scan.reportSha256 == candidate.scan.reportSha256
//@ ensures \result ==> prior.assessed.inputManifestSha256 == candidate.assessed.inputManifestSha256 && prior.assessed.templateSha256 == candidate.assessed.templateSha256 && prior.policyVersion == candidate.policyVersion && prior.scan.runId == candidate.scan.runId && prior.scan.reportSha256 == candidate.scan.reportSha256
export function sameScanEvidence(
  prior: ReuseScanEvidence,
  candidate: ReuseScanEvidence,
  priorRepository: string,
  candidateRepository: string,
): boolean {
  return (
    priorRepository === candidateRepository &&
    prior.assessed.inputManifestSha256 ===
      candidate.assessed.inputManifestSha256 &&
    reusableSourceInventory(prior) !== null &&
    reusableSourceInventory(prior) === reusableSourceInventory(candidate) &&
    prior.assessed.templateSha256 === candidate.assessed.templateSha256 &&
    prior.policyVersion === candidate.policyVersion &&
    prior.scan.runId === candidate.scan.runId &&
    prior.scan.reportSha256 === candidate.scan.reportSha256
  );
}

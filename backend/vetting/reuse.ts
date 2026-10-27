/** The same original-clean boundary governs private lookup and result intake. */
import {
  type ProjectRestriction,
  pausedByFlagsOnly,
} from "../projects/enforcement";
import type { VettingAssessment } from "./persistence";
import {
  isScanResult,
  scanSourceInventory,
  type VettingScanResult,
} from "./scan-result";

export function reusableCleanScan(
  cached: VettingAssessment | null,
  result: VettingScanResult,
  restriction: ProjectRestriction,
): boolean {
  const prior = cached?.result;
  return (
    !pausedByFlagsOnly(restriction) &&
    result.disposition === "clean" &&
    cached !== null &&
    cached.id === result.reusedAssessmentId &&
    cached.projectId === result.projectId &&
    cached.state === "clean" &&
    (restriction.since === null || cached.requestedAt >= restriction.since) &&
    prior != null &&
    isScanResult(prior) &&
    prior.projectId === result.projectId &&
    prior.disposition === "clean" &&
    prior.reusedAssessmentId === null &&
    prior.assessed.repository.toLowerCase() ===
      result.assessed.repository.toLowerCase() &&
    prior.assessed.inputManifestSha256 ===
      result.assessed.inputManifestSha256 &&
    scanSourceInventory(prior) !== null &&
    scanSourceInventory(prior) === scanSourceInventory(result) &&
    prior.assessed.templateSha256 === result.assessed.templateSha256 &&
    prior.policyVersion === result.policyVersion &&
    prior.scan.runId === result.scan.runId &&
    prior.scan.reportSha256 === result.scan.reportSha256
  );
}

/** The same original-clean boundary governs private lookup and result intake. */
import type { ProjectRestriction } from "../projects/enforcement";
import type { VettingAssessment } from "./persistence";
import {
  isScanResult,
  scanSourceInventoryInput,
  type VettingScanResult,
} from "./scan-result";
import {
  originalScanHeader,
  reusableAssessmentHeader,
  sameScanEvidence,
} from "./verified-reuse";

export function reusableCleanScan(
  cached: VettingAssessment | null,
  result: VettingScanResult,
  restriction: ProjectRestriction,
  coversActiveFlags = false,
): boolean {
  const latestRestriction =
    restriction.state === "clear"
      ? undefined
      : restriction.records
          .filter(
            (record) =>
              record.action === "quarantine" || record.action === "ban",
          )
          .at(-1);
  const prior = cached?.result;
  // Service bans require a strictly later request (0031_project_vetting_reinstatements.sql).
  if (
    !reusableAssessmentHeader(
      cached === null
        ? { kind: "missing" }
        : { kind: "present", assessment: cached },
      result.reusedAssessmentId,
      result.projectId,
      result.disposition,
      {
        state: restriction.state,
        boundary:
          latestRestriction === undefined
            ? { kind: "none" }
            : {
                kind: "record",
                actorRole: latestRestriction.actorRole,
                createdAt: latestRestriction.createdAt,
              },
      },
      coversActiveFlags,
    )
  )
    return false;
  if (prior == null || !isScanResult(prior)) return false;
  if (
    !originalScanHeader(
      prior.projectId,
      prior.disposition,
      prior.reusedAssessmentId,
      result.projectId,
    )
  )
    return false;
  const priorRepository = prior.assessed.repository.toLowerCase();
  const candidateRepository = result.assessed.repository.toLowerCase();
  return sameScanEvidence(
    scanSourceInventoryInput(prior),
    scanSourceInventoryInput(result),
    priorRepository,
    candidateRepository,
  );
}

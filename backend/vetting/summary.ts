/** Safe scan location and unchanged owner-facing failure messages. */
import type { AssessmentSummary } from "../../src/lib/vetting-contracts";
import { type RecordedVettingResult, TEMPLATE_PREFIX } from "./scan-result";

function extractPathFromEvidence(evidence: string): string | null {
  if (!evidence || typeof evidence !== "string") return null;
  const trimmed = evidence.trim();
  const match = trimmed.match(
    /^([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)(?::\d+(?::\d+)?)?$/,
  );
  return match ? match[1] : null;
}

function isTemplatePath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/^\.\//, "");
  return (
    normalized === TEMPLATE_PREFIX ||
    normalized.startsWith(`${TEMPLATE_PREFIX}/`)
  );
}

/** Classify retained paths only; model summary prose never sets a location. */
export function findingsLocationOf(
  result: RecordedVettingResult | null,
): AssessmentSummary["findingsLocation"] {
  const held =
    result?.artifacts.filter((artifact) => artifact.state !== "released") ?? [];
  let location: AssessmentSummary["findingsLocation"];
  if (result) {
    let hasTemplate = held.some((a) => isTemplatePath(a.path));
    let hasRepo = held.some((a) => !isTemplatePath(a.path));
    let hasUnknown = false;
    const findings = "findings" in result ? result.findings : [];
    for (const f of findings) {
      const extractedPath = extractPathFromEvidence(f.evidence);
      if (extractedPath === null) hasUnknown = true;
      else if (isTemplatePath(extractedPath)) hasTemplate = true;
      else hasRepo = true;
    }
    if (hasUnknown) location = "unknown";
    else if (hasTemplate && hasRepo) location = "both";
    else if (hasTemplate) location = "template";
    else if (hasRepo) location = "repository";
  }
  return location;
}

/**
 * Owner-facing reason a completed incomplete scan did not clear (issue #1991).
 * Used by setup status and the private project_scan_failed inbox detail.
 * Never includes model finding summary text.
 */
export function quarantinedScanMessage(
  assessment: Pick<AssessmentSummary, "completedAt" | "findingsLocation">,
): string {
  const loc = assessment.findingsLocation;
  if (assessment.completedAt === null || !loc) {
    return "The last scan could not finish (a check or review did not complete), so it did not clear the project.";
  }
  if (loc === "template") {
    return "Findings in Slop's skill template block clearance.";
  }
  if (loc === "repository") {
    return "Findings in the project repository block clearance.";
  }
  if (loc === "both") {
    return "Findings in both the repository and skill template block clearance.";
  }
  return "Findings block clearance.";
}

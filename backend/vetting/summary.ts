/** Safe scan location and owner-facing failure messages (issue #1991). */
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

/** Severity counts for findings whose evidence path is in the project repository. */
export type RepositoryFindingSeverityCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

/**
 * Private owner signal for issue #1991 option 2. Computed from the stored
 * scan result at an owner-authorized call site. Never placed on
 * AssessmentSummary (the public clearance summary).
 */
export type RepositoryFindingOwnerDetail = {
  severities: RepositoryFindingSeverityCounts;
  /** Distinct repository evidence paths, English-sorted, capped for display. */
  paths: string[];
  /** Distinct repository paths before the display cap. */
  pathTotal: number;
  /** Findings whose evidence did not yield a parseable path. */
  unparseableEvidence: number;
};

/** Cap owner-visible repository paths so one noisy scan cannot flood setup. */
export const MAX_REPOSITORY_FINDING_PATHS = 12;
/** Paths shown in the short status sentence (mobile-safe). */
export const MAX_REPOSITORY_FINDING_PATHS_IN_MESSAGE = 3;

/**
 * Aggregate repository finding severities and paths from a stored result.
 * Template paths are omitted. Returns null when there are no repository paths.
 * Never includes model summary text.
 */
export function repositoryFindingOwnerDetail(
  result: RecordedVettingResult | null | undefined,
): RepositoryFindingOwnerDetail | null {
  if (!result || !("findings" in result)) return null;
  const severities: RepositoryFindingSeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const repoPaths = new Set<string>();
  let unparseableEvidence = 0;
  for (const finding of result.findings) {
    const extractedPath = extractPathFromEvidence(finding.evidence);
    if (extractedPath === null) {
      unparseableEvidence += 1;
      continue;
    }
    if (isTemplatePath(extractedPath)) continue;
    severities[finding.severity] += 1;
    repoPaths.add(extractedPath);
  }
  if (repoPaths.size === 0) return null;
  const sorted = [...repoPaths].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  return {
    severities,
    paths: sorted.slice(0, MAX_REPOSITORY_FINDING_PATHS),
    pathTotal: sorted.length,
    unparseableEvidence,
  };
}

function formatOwnerRepositoryDetail(
  detail: RepositoryFindingOwnerDetail,
): string | null {
  const order = ["critical", "high", "medium", "low", "info"] as const;
  const parts = order
    .filter((severity) => detail.severities[severity] > 0)
    .map((severity) => `${detail.severities[severity]} ${severity}`);
  if (parts.length === 0) return null;
  const shown = detail.paths.slice(0, MAX_REPOSITORY_FINDING_PATHS_IN_MESSAGE);
  const omittedPaths = Math.max(detail.pathTotal - shown.length, 0);
  const notes: string[] = [];
  if (omittedPaths > 0) {
    notes.push(
      `${omittedPaths} more path${omittedPaths === 1 ? "" : "s"} omitted`,
    );
  } else if (detail.pathTotal > detail.paths.length) {
    // Cap on the detail object itself; message already used all retained paths.
    notes.push("path list partial");
  }
  if (detail.unparseableEvidence > 0) {
    notes.push(
      `${detail.unparseableEvidence} unparseable evidence reference${detail.unparseableEvidence === 1 ? "" : "s"}`,
    );
  }
  const pathText = shown.join(", ");
  const noteText = notes.length > 0 ? ` (${notes.join("; ")})` : "";
  return `${parts.join(", ")} in ${pathText}${noteText}`;
}

/**
 * Owner-facing reason a completed incomplete scan did not clear (issue #1991).
 * Used by setup status and the private project_scan_failed inbox detail.
 * Never includes model finding summary text.
 *
 * Optional `ownerDetail` adds short severity/path counts for repository
 * findings. Callers must supply it only behind verified owner authority (setup)
 * or another owner-only channel (inbox). Public AssessmentSummary never carries it.
 */
export function quarantinedScanMessage(
  assessment: Pick<AssessmentSummary, "completedAt" | "findingsLocation">,
  ownerDetail: RepositoryFindingOwnerDetail | null = null,
): string {
  const loc = assessment.findingsLocation;
  if (assessment.completedAt === null || !loc) {
    return "The last scan could not finish, so it did not clear the project.";
  }
  if (loc === "template") {
    return "Findings in Slop's skill template block clearance.";
  }
  const detailText =
    (loc === "repository" || loc === "both") && ownerDetail !== null
      ? formatOwnerRepositoryDetail(ownerDetail)
      : null;
  if (loc === "repository") {
    return detailText
      ? `Findings in the project repository block clearance: ${detailText}.`
      : "Findings in the project repository block clearance.";
  }
  if (loc === "both") {
    return detailText
      ? `Findings in both the repository and skill template block clearance. Repository: ${detailText}.`
      : "Findings in both the repository and skill template block clearance.";
  }
  return "Findings block clearance.";
}

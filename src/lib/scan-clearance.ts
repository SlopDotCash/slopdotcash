/**
 * Why an incomplete bounded admission scan did not clear, as short status
 * badges for the project owner (issue #1991, PRD section 8). Every badge
 * comes from `ScanClearanceFacts`: recorded enumerations, counts and the
 * scanner's own coverage notes. No finding summary, model text, prompt or
 * source content can reach it. Setup status and the admin vetting view show
 * the same badges, so they agree by construction.
 */
import type { AssessmentSummary, ScanReviewOutcome } from "./vetting-contracts";

export type ScanClearanceTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

/** Decorative icon key; the label always carries the state in words. */
export type ScanClearanceIcon =
  | "pass"
  | "fail"
  | "skip"
  | "partial"
  | "held"
  | "note"
  | "review";

export type ScanClearanceBadge = {
  tone: ScanClearanceTone;
  icon: ScanClearanceIcon;
  label: string;
};

/** Badges grouped in the order the owner can act on them. */
export type ScanClearanceView = {
  checks: ScanClearanceBadge[];
  coverage: ScanClearanceBadge[];
  review: ScanClearanceBadge[];
};

/** `wallet-drainer` reads "wallet drainer"; `installScripts` reads "install scripts". */
function words(value: string): string {
  return value
    .replace(
      /([a-z])([A-Z])/gu,
      (_match, before, after) => `${before} ${after.toLowerCase()}`,
    )
    .replaceAll("-", " ");
}

function reviewBadge(
  name: "Primary" | "Specialist",
  review: ScanReviewOutcome,
): ScanClearanceBadge {
  if (review.status !== "completed")
    return {
      tone: "neutral",
      icon: "skip",
      label: `${name} ${review.status === "not-started" ? "not run" : review.status}`,
    };
  if (review.verdict === "malicious-suspected")
    return {
      tone: "danger",
      icon: "fail",
      label: `${name}: suspected malicious`,
    };
  if (review.risk === "high")
    return { tone: "danger", icon: "fail", label: `${name}: high risk` };
  if (review.risk === "ambiguous")
    return { tone: "warning", icon: "review", label: `${name}: ambiguous` };
  if (review.verdict === "findings")
    return { tone: "warning", icon: "review", label: `${name}: findings` };
  return { tone: "success", icon: "pass", label: `${name}: clear` };
}

const REVIEW_AREA_GAP = /^(primary|specialist):([A-Za-z]+):partial$/u;

function unique(badges: ScanClearanceBadge[]): ScanClearanceBadge[] {
  const seen = new Set<string>();
  return badges.filter((badge) => {
    if (seen.has(badge.label)) return false;
    seen.add(badge.label);
    return true;
  });
}

/**
 * The owner-facing badges of an incomplete scan. Null for any other state or
 * for a historical result.
 */
export function scanClearanceView(
  assessment: Pick<
    AssessmentSummary,
    "state" | "scan" | "heldArtifacts" | "findingsLocation"
  >,
): ScanClearanceView | null {
  const facts = assessment.scan;
  if (facts === undefined || assessment.state !== "incomplete") return null;
  const checks: ScanClearanceBadge[] = [];
  const coverage: ScanClearanceBadge[] = [];
  let slopSide = false;
  const repositoryClear =
    facts.flaggedChecks.length === 0 &&
    facts.checksNotRun.length === 0 &&
    facts.incompleteSurfaces.length === 0 &&
    facts.openFindings.length === 0 &&
    assessment.heldArtifacts === 0;
  // The Slop-side badge must agree with the heading, which follows
  // `findingsLocation` at every severity: a finding below high at a
  // repository path still points the owner at the repository.
  const location = assessment.findingsLocation;
  const passed: ScanClearanceBadge = {
    tone: "success",
    icon: "pass",
    label: "No check flagged",
  };
  if (repositoryClear) {
    if (location === undefined || location === "template") {
      checks.push(passed);
      slopSide = true;
    } else if (location === "repository" || location === "both")
      checks.push(passed, {
        tone: "warning",
        icon: "note",
        label:
          location === "both"
            ? "Findings: repository + template"
            : "Findings: repository",
      });
  }
  for (const threat of facts.flaggedChecks) {
    const open =
      facts.openFindings.find((finding) => finding.category === threat)
        ?.count ?? 0;
    checks.push({
      tone: "danger",
      icon: "fail",
      label: `${words(threat)} flagged${open > 0 ? ` · ${open} high` : ""}`,
    });
  }
  for (const { category, count } of facts.openFindings)
    if (!facts.flaggedChecks.includes(category))
      checks.push({
        tone: "danger",
        icon: "fail",
        label: `${words(category)} · ${count} high`,
      });
  for (const threat of facts.checksNotRun)
    checks.push({
      tone: "neutral",
      icon: "skip",
      label: `${words(threat)} not run`,
    });
  for (const { surface, state } of facts.incompleteSurfaces)
    coverage.push(
      state === "partial"
        ? {
            tone: "warning",
            icon: "partial",
            label: `${words(surface)} partial`,
          }
        : {
            tone: "neutral",
            icon: "skip",
            label: `${words(surface)} unsupported`,
          },
    );
  if (assessment.heldArtifacts > 0)
    coverage.push({
      tone: "warning",
      icon: "held",
      label: `${assessment.heldArtifacts} artifact${assessment.heldArtifacts === 1 ? "" : "s"} held`,
    });
  for (const gap of facts.visibilityGaps) {
    const area = REVIEW_AREA_GAP.exec(gap);
    coverage.push(
      area
        ? {
            tone: "warning",
            icon: "partial",
            label: `${area[1] === "primary" ? "Primary" : "Specialist"}: ${words(area[2])} partial`,
          }
        : { tone: "neutral", icon: "note", label: gap },
    );
  }
  const review = [reviewBadge("Primary", facts.review.primary)];
  if (facts.review.specialist !== null)
    review.push(reviewBadge("Specialist", facts.review.specialist));
  else if (facts.review.escalated)
    review.push({ tone: "danger", icon: "skip", label: "Specialist not run" });
  // Nothing in the repository was flagged: changing it will not clear this.
  if (slopSide)
    review.push({ tone: "info", icon: "note", label: "Slop-side block" });
  return {
    checks: unique(checks),
    coverage: unique(coverage),
    review: unique(review),
  };
}

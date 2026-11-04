/**
 * Why an incomplete bounded admission scan did not clear, in generic
 * sentences for the project owner (issue #1991, PRD section 8). Every
 * sentence comes from `ScanClearanceFacts`: recorded enumerations, counts and
 * the scanner's own coverage notes. No finding summary, model text, prompt or
 * source content can reach it. Setup status and the admin vetting view show
 * the same list, so they agree by construction.
 */
import type {
  AssessmentSummary,
  ScanClearanceFacts,
  ScanReviewOutcome,
} from "./vetting-contracts";

/** `wallet-drainer` reads "wallet drainer"; `installScripts` reads "install scripts". */
function words(value: string): string {
  return value
    .replace(
      /([a-z])([A-Z])/gu,
      (_match, before, after) => `${before} ${after.toLowerCase()}`,
    )
    .replaceAll("-", " ");
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

const NOT_COMPLETED: Record<
  Exclude<ScanReviewOutcome["status"], "completed">,
  string
> = {
  unavailable: "was unavailable",
  failed: "failed",
  "not-started": "did not run",
};

function reviewText(review: ScanReviewOutcome): string {
  if (review.status !== "completed") return NOT_COMPLETED[review.status];
  const verdict =
    review.verdict === "no-findings"
      ? "reported no findings"
      : review.verdict === "findings"
        ? "reported findings"
        : "suspected malicious content";
  return review.risk === "low" || review.risk === null
    ? verdict
    : `${verdict} and rated the result ${review.risk === "high" ? "high risk" : "ambiguous"}`;
}

function reviewOutcome(review: ScanClearanceFacts["review"]): string {
  const primary = `The primary review ${reviewText(review.primary)}`;
  const specialist = review.specialist;
  if (specialist === null)
    return review.escalated
      ? `${primary}, and the specialist review that this result requires did not run.`
      : `${primary}, and no specialist review was required.`;
  if (specialist.status !== "completed")
    return `${primary}, and the specialist review ${NOT_COMPLETED[specialist.status]}.`;
  const cleared =
    specialist.verdict === "no-findings" && specialist.risk === "low";
  return cleared
    ? `${primary}, and the specialist review ${reviewText(specialist)}.`
    : `${primary}, and the specialist review did not clear it: it ${reviewText(specialist)}.`;
}

const REVIEW_AREA_GAP = /^(primary|specialist):([A-Za-z]+):partial$/u;

/**
 * The owner-facing reasons of an incomplete scan, in the order the owner can
 * act on them: the repository first, then the scanner's coverage, then the
 * review outcome. Empty for any other state or for a historical result.
 */
export function scanClearanceReasons(
  assessment: Pick<AssessmentSummary, "state" | "scan" | "heldArtifacts">,
): string[] {
  const facts = assessment.scan;
  if (facts === undefined || assessment.state !== "incomplete") return [];
  const reasons: string[] = [];
  const repositoryClear =
    facts.flaggedChecks.length === 0 &&
    facts.checksNotRun.length === 0 &&
    facts.incompleteSurfaces.length === 0 &&
    facts.openFindings.length === 0 &&
    assessment.heldArtifacts === 0;
  if (repositoryClear)
    reasons.push(
      "Every deterministic check passed and every surface was read completely, so nothing in the repository was flagged by the checks. The block is a review-coverage decision on Slop's side; changing the repository will not clear it.",
    );
  for (const threat of facts.flaggedChecks) {
    const open =
      facts.openFindings.find((finding) => finding.category === threat)
        ?.count ?? 0;
    reasons.push(
      `The ${words(threat)} check flagged content${open > 0 ? ` (${count(open, "open finding", "open findings")} rated high or critical)` : ""}.`,
    );
  }
  for (const { category, count: open } of facts.openFindings)
    if (!facts.flaggedChecks.includes(category))
      reasons.push(
        `${count(open, "open finding is", "open findings are")} rated high or critical under ${words(category)}.`,
      );
  for (const threat of facts.checksNotRun)
    reasons.push(`The ${words(threat)} check did not run.`);
  for (const { surface, state } of facts.incompleteSurfaces)
    reasons.push(
      state === "partial"
        ? `The ${words(surface)} surface was read partially.`
        : `The ${words(surface)} surface is not supported by the scan.`,
    );
  if (assessment.heldArtifacts > 0)
    reasons.push(
      `${count(assessment.heldArtifacts, "downloaded or binary artifact stays", "downloaded or binary artifacts stay")} quarantined without a clean analysis.`,
    );
  for (const gap of facts.visibilityGaps) {
    const area = REVIEW_AREA_GAP.exec(gap);
    reasons.push(
      area
        ? `The ${area[1]} review covered the ${words(area[2])} area partially.`
        : `Coverage note from the scanner: ${gap}`,
    );
  }
  reasons.push(reviewOutcome(facts.review));
  return reasons;
}

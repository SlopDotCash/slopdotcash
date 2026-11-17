// spec/security/enforcement.md, "Clearance and restrictions are separate dimensions with their own records"; spec/security/enforcement.md, "A recorded incomplete result, an acquisition refusal included, notifies the listing account and the steward once"
export type ClearanceTone = "success" | "warning" | "danger" | "info" | "neutral";
export type ClearanceIcon = "pass" | "fail" | "skip" | "partial" | "held" | "note" | "review";
export type FindingsLocation = "repository" | "template" | "both" | "unknown";

export interface ClearanceBadge {
  readonly tone: ClearanceTone;
  readonly icon: ClearanceIcon;
  readonly label: string;
}

export interface ClearanceView {
  readonly checks: ReadonlyArray<ClearanceBadge>;
  readonly coverage: ReadonlyArray<ClearanceBadge>;
  readonly review: ReadonlyArray<ClearanceBadge>;
}

export interface ScanReviewOutcome {
  readonly status: "completed" | "unavailable" | "failed" | "not-started";
  readonly verdict: "no-findings" | "findings" | "malicious-suspected" | null;
  readonly risk: "low" | "ambiguous" | "high" | null;
}

export interface ScanClearanceFacts {
  readonly flaggedChecks: ReadonlyArray<string>;
  readonly checksNotRun: ReadonlyArray<string>;
  readonly incompleteSurfaces: ReadonlyArray<{ readonly surface: string; readonly state: "partial" | "unsupported" }>;
  readonly visibilityGaps: ReadonlyArray<string>;
  readonly openFindings: ReadonlyArray<{ readonly category: string; readonly count: number }>;
  readonly review: { readonly primary: ScanReviewOutcome; readonly specialist: ScanReviewOutcome | null; readonly escalated: boolean };
}

export interface ScannedAssessment {
  readonly state: string;
  readonly heldArtifacts: number;
  readonly findingsLocation?: FindingsLocation;
  readonly scan?: ScanClearanceFacts;
}

const reviewAreaGap = /^(primary|specialist):([A-Za-z]+):partial$/u;

const badge = (tone: ClearanceTone, icon: ClearanceIcon, label: string): ClearanceBadge => ({ tone, icon, label });

function words(value: string): string {
  return value.replace(/([a-z])([A-Z])/gu, (_match, before: string, after: string) => `${before} ${after.toLowerCase()}`).replaceAll("-", " ");
}

function reviewBadge(name: "Primary" | "Specialist", review: ScanReviewOutcome): ClearanceBadge {
  if (review.status !== "completed") return badge("neutral", "skip", `${name} ${review.status === "not-started" ? "not run" : review.status}`);
  if (review.verdict === "malicious-suspected") return badge("danger", "fail", `${name}: suspected malicious`);
  if (review.risk === "high") return badge("danger", "fail", `${name}: high risk`);
  if (review.risk === "ambiguous") return badge("warning", "review", `${name}: ambiguous`);
  if (review.verdict === "findings") return badge("warning", "review", `${name}: findings`);
  return badge("success", "pass", `${name}: clear`);
}

function unique(badges: ReadonlyArray<ClearanceBadge>): ReadonlyArray<ClearanceBadge> {
  return badges.filter((entry, index) => badges.findIndex((other) => other.label === entry.label) === index);
}

function checksOf(facts: ScanClearanceFacts, assessment: ScannedAssessment): { readonly checks: ReadonlyArray<ClearanceBadge>; readonly slopSide: boolean } {
  const repositoryClear = facts.flaggedChecks.length === 0 && facts.checksNotRun.length === 0 && facts.incompleteSurfaces.length === 0 && facts.openFindings.length === 0 && assessment.heldArtifacts === 0;
  const location = assessment.findingsLocation;
  const passed = badge("success", "pass", "No check flagged");
  const slopSide = repositoryClear && (location === undefined || location === "template");
  const clear = !repositoryClear ? [] : slopSide ? [passed] : location === "repository" || location === "both" ? [passed, badge("warning", "note", location === "both" ? "Findings: repository + template" : "Findings: repository")] : [];
  const flagged = facts.flaggedChecks.map((threat) => {
    const open = facts.openFindings.find((finding) => finding.category === threat)?.count ?? 0;
    return badge("danger", "fail", `${words(threat)} flagged${open > 0 ? ` · ${open} high` : ""}`);
  });
  const findings = facts.openFindings.filter((finding) => !facts.flaggedChecks.includes(finding.category)).map((finding) => badge("danger", "fail", `${words(finding.category)} · ${finding.count} high`));
  const notRun = facts.checksNotRun.map((threat) => badge("neutral", "skip", `${words(threat)} not run`));
  return { checks: [...clear, ...flagged, ...findings, ...notRun], slopSide };
}

function coverageOf(facts: ScanClearanceFacts, heldArtifacts: number): ReadonlyArray<ClearanceBadge> {
  const surfaces = facts.incompleteSurfaces.map(({ surface, state }) => (state === "partial" ? badge("warning", "partial", `${words(surface)} partial`) : badge("neutral", "skip", `${words(surface)} unsupported`)));
  const held = heldArtifacts > 0 ? [badge("warning", "held", `${heldArtifacts} artifact${heldArtifacts === 1 ? "" : "s"} held`)] : [];
  const gaps = facts.visibilityGaps.map((gap) => {
    const area = reviewAreaGap.exec(gap);
    return area === null ? badge("neutral", "note", gap) : badge("warning", "partial", `${area[1] === "primary" ? "Primary" : "Specialist"}: ${words(area[2] ?? "")} partial`);
  });
  return [...surfaces, ...held, ...gaps];
}

/** @throws {never} */
export function scanClearanceView(assessment: ScannedAssessment): ClearanceView | null {
  const facts = assessment.scan;
  if (facts === undefined || assessment.state !== "incomplete") return null;
  const { checks, slopSide } = checksOf(facts, assessment);
  const specialist = facts.review.specialist !== null ? [reviewBadge("Specialist", facts.review.specialist)] : facts.review.escalated ? [badge("danger", "skip", "Specialist not run")] : [];
  const review = [reviewBadge("Primary", facts.review.primary), ...specialist, ...(slopSide ? [badge("info", "note", "Slop-side block")] : [])];
  return { checks: unique(checks), coverage: unique(coverageOf(facts, assessment.heldArtifacts)), review: unique(review) };
}

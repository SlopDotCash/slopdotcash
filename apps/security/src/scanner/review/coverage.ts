// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"; spec/security/admission.md, "The primary review decides and an ambiguous or high-risk finding needs the specialist"
import { type CoverageGap, SCAN_REVIEW_AREAS, type ScanArea, type ScannerEvidence, type VerifiedCoverage } from "../providers/review.ts";

export interface CoverageScope {
  readonly kind: "single" | "batch" | "synthesis";
  readonly supplied: ReadonlySet<string>;
  readonly elsewhere: ReadonlySet<string>;
  readonly covered: ReadonlySet<string>;
}

type Resolution = "unreviewed" | "resolved" | "outside-revision";

const RANK: Readonly<Record<VerifiedCoverage, number>> = { complete: 0, "outside-revision": 1, partial: 2, missing: 3 };

/** @throws {never} */
export function referencedPath(reference: string): string {
  const trimmed = reference.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) return trimmed;
  const path = trimmed
    .replace(/(?:#(?:part-\d+-of-\d+|signals))+$/u, "")
    .replace(/#L\d+(?:-L?\d+)?$/u, "")
    .replace(/:\d+(?::\d+)?(?:-\d+)?$/u, "");
  return path.startsWith("/slop-scan/") ? path : path.replace(/^(?:\.\/|\/)+/u, "");
}

function resolve(gap: CoverageGap, scope: CoverageScope): Resolution {
  if (gap.supplied) return scope.kind === "synthesis" ? "resolved" : "unreviewed";
  const path = referencedPath(gap.reference);
  if (scope.kind !== "synthesis" && scope.supplied.has(path)) return "unreviewed";
  if (scope.elsewhere.has(path) || scope.covered.has(path)) return "resolved";
  if (scope.kind === "synthesis" && scope.supplied.has(path)) return "resolved";
  return "outside-revision";
}

/** @throws {never} */
export function worstCoverage(states: ReadonlyArray<VerifiedCoverage>): VerifiedCoverage {
  return states.reduce<VerifiedCoverage>((worst, state) => (RANK[state] > RANK[worst] ? state : worst), "complete");
}

function verifiedArea(evidence: ScannerEvidence, threat: ScanArea, scope: CoverageScope): VerifiedCoverage {
  const state = evidence.coverage?.[threat] ?? "missing";
  if (state !== "partial") return state;
  const reasons = (evidence.coverageGaps ?? []).filter((gap) => gap.threat === threat).map((gap) => resolve(gap, scope));
  if (reasons.length === 0 || reasons.includes("unreviewed")) return "partial";
  return reasons.includes("outside-revision") ? "outside-revision" : "complete";
}

/** @throws {never} */
export function verifyCoverage(evidence: ScannerEvidence, scope: CoverageScope): ScannerEvidence {
  if (evidence.review.status !== "completed" || evidence.coverage === null) return evidence;
  const reviewer = evidence.review.reviewer;
  const verified = Object.fromEntries(SCAN_REVIEW_AREAS.map((threat) => [threat, verifiedArea(evidence, threat, scope)])) as Record<ScanArea, VerifiedCoverage>;
  const raw = new Set(SCAN_REVIEW_AREAS.flatMap((threat) => ["partial", "missing"].map((state) => `${reviewer}:${threat}:${state}`)));
  return {
    ...evidence,
    verifiedCoverage: verified,
    visibilityGaps: [
      ...evidence.visibilityGaps.filter((gap) => !raw.has(gap)),
      ...SCAN_REVIEW_AREAS.flatMap((threat) => (verified[threat] === "complete" ? [] : [`${reviewer}:${threat}:${verified[threat]}`])),
    ],
  };
}

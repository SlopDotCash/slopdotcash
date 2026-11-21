/**
 * Checks a reviewer's coverage call against the evidence the scan supplied
 * (PRD section 8, operator decision of 19 November 2026). A reviewer that
 * marks a threat partial or missing must name what stopped it
 * (`CoverageGap`). Each reason is then sorted by what the scanner itself
 * knows, never by what the reviewer claims:
 *
 * - a supplied item, or content supplied to this same call, is unreviewed
 *   content: the area stays `partial` and the scan cannot be clean;
 * - content another completed batch reviewed, a deterministic-only file
 *   (bulk content and Slop's queued template), a well-formed image or a
 *   recorded artifact is covered by the scan's own records: the reason is
 *   resolved;
 * - anything that is not part of the acquired revision (an external
 *   download, package or service) is outside the bounded scan:
 *   `outside-revision`, recorded and advisory.
 *
 * A `missing` area, or a non-complete area with no reason, stays blocking.
 * Install-time downloads the deterministic pass finds remain scanner gaps of
 * their own and keep the scan incomplete whatever a reviewer says.
 */
import { SCAN_THREATS } from "../../backend/vetting/scan-result";
import type {
  CoverageGap,
  ScannerEvidence,
  VerifiedCoverage,
} from "./scanners";

export type CoverageScope = {
  /** "synthesis" reads batch results; its supplied items are summaries. */
  kind: "single" | "batch" | "synthesis";
  /** Repository paths whose bodies were supplied to this call. */
  supplied: ReadonlySet<string>;
  /** Paths whose bodies another completed batch reviewed. */
  elsewhere: ReadonlySet<string>;
  /** Paths the scan covered without a model read of their bodies. */
  covered: ReadonlySet<string>;
};

/** The repository path an item id or reviewer reference names. */
export function referencedPath(reference: string): string {
  let path = reference.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(path)) return path;
  path = path
    .replace(/(?:#(?:part-\d+-of-\d+|signals))+$/u, "")
    .replace(/#L\d+(?:-L?\d+)?$/u, "")
    .replace(/:\d+(?::\d+)?(?:-\d+)?$/u, "");
  if (!path.startsWith("/slop-scan/"))
    path = path.replace(/^(?:\.\/|\/)+/u, "");
  return path;
}

type Resolution = "unreviewed" | "resolved" | "outside-revision";

function resolve(gap: CoverageGap, scope: CoverageScope): Resolution {
  if (gap.supplied)
    return scope.kind === "synthesis" ? "resolved" : "unreviewed";
  const path = referencedPath(gap.reference);
  // Content supplied to this very call was not reviewed, whatever the
  // reviewer called it. A synthesis is supplied only batch results.
  if (scope.kind !== "synthesis" && scope.supplied.has(path))
    return "unreviewed";
  if (scope.elsewhere.has(path) || scope.covered.has(path)) return "resolved";
  if (scope.kind === "synthesis" && scope.supplied.has(path)) return "resolved";
  return "outside-revision";
}

const RANK: Record<VerifiedCoverage, number> = {
  complete: 0,
  "outside-revision": 1,
  partial: 2,
  missing: 3,
};

export function worstCoverage(
  states: readonly VerifiedCoverage[],
): VerifiedCoverage {
  return states.reduce<VerifiedCoverage>(
    (worst, state) => (RANK[state] > RANK[worst] ? state : worst),
    "complete",
  );
}

/**
 * The verified coverage of one completed call, and its visibility gaps with
 * each `<reviewer>:<threat>:<state>` entry rewritten to the verified state:
 * dropped when resolved, `outside-revision` when advisory, kept otherwise.
 */
export function verifyCoverage(
  evidence: ScannerEvidence,
  scope: CoverageScope,
): ScannerEvidence {
  if (evidence.review.status !== "completed" || evidence.coverage === null)
    return evidence;
  const reviewer = evidence.review.reviewer;
  const gaps = evidence.coverageGaps ?? [];
  const verified = Object.fromEntries(
    SCAN_THREATS.map((threat) => {
      const state = evidence.coverage?.[threat] ?? "missing";
      if (state === "complete") return [threat, "complete"];
      if (state === "missing") return [threat, "missing"];
      const reasons = gaps
        .filter((gap) => gap.threat === threat)
        .map((gap) => resolve(gap, scope));
      if (reasons.length === 0 || reasons.includes("unreviewed"))
        return [threat, "partial"];
      return [
        threat,
        reasons.includes("outside-revision") ? "outside-revision" : "complete",
      ];
    }),
  ) as Record<string, VerifiedCoverage>;
  const raw = new Set(
    SCAN_THREATS.flatMap((threat) =>
      ["partial", "missing"].map((state) => `${reviewer}:${threat}:${state}`),
    ),
  );
  return {
    ...evidence,
    verifiedCoverage: verified,
    visibilityGaps: [
      ...evidence.visibilityGaps.filter((gap) => !raw.has(gap)),
      ...SCAN_THREATS.flatMap((threat) =>
        verified[threat] === "complete"
          ? []
          : [`${reviewer}:${threat}:${verified[threat]}`],
      ),
    ],
  };
}

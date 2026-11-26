/**
 * How a private case shows the state GitHub last listed for its advisory
 * (operator decision, 25 November 2026; PRD section 8). Display only: Slop
 * never changes an advisory on GitHub, so a case closed here can still be
 * open there until a maintainer closes it on GitHub.
 */

const LABELS: Record<string, string> = {
  triage: "Open, in triage",
  draft: "Open, draft",
  published: "Published",
  closed: "Closed",
};

/** Slop decisions after which an advisory still open on GitHub is left over. */
const CLOSING_RECEIPTS = new Set(["duplicate", "out-of-scope", "rejected"]);

export type AdvisoryGithubLine = {
  label: string;
  /** Decided here and still open on GitHub: offer the maintainer the link. */
  closeOnGithub: boolean;
};

/** Null when Slop holds no state GitHub reported for the advisory. */
export function advisoryGithubLine(input: {
  githubState: string | null | undefined;
  receiptState: string | null | undefined;
  maintainer: boolean;
}): AdvisoryGithubLine | null {
  const label = input.githubState ? LABELS[input.githubState] : undefined;
  if (label === undefined) return null;
  return {
    label,
    closeOnGithub:
      input.maintainer &&
      (input.githubState === "triage" || input.githubState === "draft") &&
      CLOSING_RECEIPTS.has(input.receiptState ?? ""),
  };
}

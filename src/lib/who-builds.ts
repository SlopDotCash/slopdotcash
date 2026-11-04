/**
 * Where the scored work on Slop lands, by repository.
 *
 * Every figure here is a view over data the snapshot already publishes: the
 * ledger of scored events and the reviewed project manifests that register
 * each repository. Nothing is fetched and nothing changes score. The module
 * only counts scored events per repository and labels each one with the
 * manifest's own description, so a sponsor can see what kind of code the
 * leaderboard's contributors chose to work on inside the current window.
 */

/**
 * The dated cross-reference quoted on /sponsors.
 *
 * Every figure the page shows comes from the snapshot imported below, which
 * is committed under data/who-builds and pinned by SHA-256. The site never
 * recomputes it. To refresh: commit a new dated directory with its
 * snapshot.json and METHOD.md, then point the import and the hash below at
 * it. A unit test hashes the committed file and fails if the two disagree.
 */
import snapshotJson from "../../data/who-builds/2026-09-17/snapshot.json";

interface WhoBuildsCohort {
  name: string;
  /** Contributors in the cohort. */
  size: number;
  /** Contributors with at least one described public repository in 2026. */
  classifiable: number;
  /** Classifiable contributors whose primary focus is AI agents or LLM tooling. */
  aiPrimary: number;
  /** Contributors with a merged pull request into an outside AI repository in 2026. */
  aiExternalPr: number;
}

interface WhoBuildsFocusArea {
  area: string;
  /** Outside repositories assigned this focus area. */
  repos: number;
  /** Merged pull requests into those repositories. */
  prs: number;
  /** Contributors with at least one merged pull request in the area. */
  contributors: number;
  /** Contributors whose dominant 2026 category is this area. */
  primaryContributors: number;
}

interface WhoBuildsRepository {
  /** GitHub `owner/name`. */
  repo: string;
  /** Merged pull requests from leaderboard contributors in 2026. */
  prs: number;
  /** Leaderboard contributors with at least one merged pull request there. */
  contributors: number;
  stars: number;
}

interface WhoBuildsSnapshot {
  /** Date the cross-reference was run, YYYY-MM-DD. */
  generatedAt: string;
  leaderboardGeneratedAt: string;
  window: { days: number; from: string; to: string };
  ruleVersion: string;
  /** Contributors on the leaderboard the snapshot was taken from. */
  contributors: number;
  noFootprint: number;
  unclassifiable: number;
  externalRepos: number;
  /** Outside repositories with a merged pull request, mass accounts excluded. */
  externalReposExMass: number;
  /** Merged pull requests into outside repositories, mass accounts excluded. */
  externalPrsExMass: number;
  contributorsWithExternal: number;
  /** Median star count of the outside AI repositories they merged into. */
  aiRepoMedianStars: number;
  /** Share of those repositories with fewer than ten stars, in [0, 1]. */
  aiRepoShareUnder10: number;
  cohorts: WhoBuildsCohort[];
  focus: WhoBuildsFocusArea[];
  topAi: (WhoBuildsRepository & { desc: string })[];
  recognizable: WhoBuildsRepository[];
  topOther: {
    repo: string;
    prs: number;
    area: string;
    stars: number;
    desc: string;
  }[];
  massAccounts: { login: string; prs: number; repos: number }[];
}

/** The committed, hash-pinned cross-reference the page renders from. */
export const WHO_BUILDS_SNAPSHOT: WhoBuildsSnapshot = snapshotJson;

/** Where the snapshot lives and how it is pinned. Update with the import. */
export const WHO_BUILDS_CROSS_REFERENCE = {
  /** Date the cross-reference was run. */
  date: WHO_BUILDS_SNAPSHOT.generatedAt,
  /** Repository path of the pinned snapshot. */
  snapshotPath: `data/who-builds/${WHO_BUILDS_SNAPSHOT.generatedAt}/snapshot.json`,
  /** Repository path of the method note beside the snapshot. */
  methodPath: `data/who-builds/${WHO_BUILDS_SNAPSHOT.generatedAt}/METHOD.md`,
  /** Lowercase SHA-256 of the committed snapshot file. */
  snapshotSha256:
    "edc05b350e371c50e0b5f72d01c92ea626ed03e23474febd5ddaf0f85c7df306",
} as const;

/** "8 September 2026" for a YYYY-MM-DD snapshot date. */
export function whoBuildsDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

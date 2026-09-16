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

import type { LeaderboardSnapshot } from "./leaderboard-types";
import { findProjectByRepositoryId } from "./projects.mjs";

/**
 * The dated cross-reference quoted on /sponsors. The figures are read from a
 * snapshot committed under data/who-builds, pinned by SHA-256, so the page
 * cites a fixed artifact in this repository rather than a live third-party
 * deployment. A unit test hashes the committed file and checks every figure
 * below against it; the site itself never recomputes them.
 */
export const WHO_BUILDS_CROSS_REFERENCE = {
  /** Date the cross-reference was run. */
  date: "2026-09-08",
  /** Human-readable form used on the page. */
  dateLabel: "8 September 2026",
  /** Repository path of the pinned snapshot. */
  snapshotPath: "data/who-builds/2026-09-08/snapshot.json",
  /** Repository path of the method note beside the snapshot. */
  methodPath: "data/who-builds/2026-09-08/METHOD.md",
  /** Lowercase SHA-256 of the committed snapshot file. */
  snapshotSha256:
    "540df0156b3b7ac5ba8e283d795ef93bcd4642cff889953b4af8a97af2eb4c47",
  /** Rendered view of the same snapshot, outside this repository. */
  renderedUrl: "https://who-builds-on-slop.vercel.app",
  /** Leaders on the leaderboard the snapshot was taken from. */
  contributors: 119,
  /** Leaders with at least one described public repository in 2026. */
  classifiable: 86,
  /** Classifiable leaders whose primary focus is AI agents or LLM tooling. */
  aiPrimary: 64,
  /** Leaders with a merged pull request into an outside AI repository in 2026. */
  aiExternalPullRequest: 50,
  /** Mass pull-request accounts excluded from repository-level figures. */
  excludedMassAccounts: 2,
} as const;

export interface RepositoryFootprint {
  /** Registered repository id, for example `elizaOS/eliza`. */
  repositoryId: string;
  /** Manifest display name for the repository, or the id when unregistered. */
  displayName: string;
  /** Manifest description of the repository, or null when unregistered. */
  description: string | null;
  /** Owning project id from the reviewed manifest, or null when unregistered. */
  projectId: string | null;
  /** Owning project name from the reviewed manifest, or null when unregistered. */
  projectName: string | null;
  /** Scored ledger events on this repository inside the window. */
  events: number;
  /** Share of all scored ledger events, in [0, 1]. */
  share: number;
}

export interface WhoBuildsSummary {
  windowDays: number;
  /** Contributors on the leaderboard for the window. */
  contributors: number;
  /** Scored ledger events across every repository. */
  scoredEvents: number;
  /** Repositories with at least one scored event, busiest first. */
  repositories: RepositoryFootprint[];
}

/**
 * Counts scored ledger events per repository and resolves each repository to
 * its reviewed manifest. Repositories with no scored events are omitted. Ties
 * break on repository id so the order is deterministic.
 */
export function summarizeWhoBuilds(
  snapshot: LeaderboardSnapshot,
): WhoBuildsSummary {
  const counts = new Map<string, number>();
  for (const event of snapshot.ledger) {
    counts.set(event.repository, (counts.get(event.repository) ?? 0) + 1);
  }
  const scoredEvents = snapshot.ledger.length;
  const repositories = [...counts.entries()]
    .map(([repositoryId, events]) => {
      const project = findProjectByRepositoryId(repositoryId);
      const repository =
        project?.repositories.find(
          (entry) => entry.id.toLowerCase() === repositoryId.toLowerCase(),
        ) ?? null;
      return {
        repositoryId,
        displayName: repository?.displayName ?? repositoryId,
        description: repository?.description ?? null,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        events,
        share: scoredEvents > 0 ? events / scoredEvents : 0,
      };
    })
    .sort(
      (left, right) =>
        right.events - left.events ||
        left.repositoryId.localeCompare(right.repositoryId),
    );
  return {
    windowDays: snapshot.window.days,
    contributors: snapshot.leaders.length,
    scoredEvents,
    repositories,
  };
}

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

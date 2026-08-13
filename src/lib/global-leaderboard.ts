/**
 * Builds the cumulative cross-project leaderboard from accepted score events
 * and immutable closed-cycle records. A closed cycle replaces overlapping
 * rolling-window events so its complete score is counted exactly once.
 */

import type { CycleIndex } from "./cycle-index";
import type { GitHubActor, LeaderboardSnapshot } from "./leaderboard";
import type { ProjectView } from "./project-view";
import { findProjectByRepositoryId } from "./projects.mjs";

export interface GlobalLeader {
  actor: GitHubActor;
  score: number;
  tokens: number;
  projectedMinor: bigint;
  paidMinor: bigint;
  projects: number;
  cycles: number;
}

type MutableGlobalLeader = Omit<GlobalLeader, "cycles" | "projects"> & {
  cycleKeys: Set<string>;
  projectIds: Set<string>;
};

function compareActors(left: GitHubActor, right: GitHubActor): number {
  const leftLogin = left.login.toLowerCase();
  const rightLogin = right.login.toLowerCase();
  return (
    leftLogin.localeCompare(rightLogin) ||
    left.login.localeCompare(right.login) ||
    left.id.localeCompare(right.id)
  );
}

function actorFromCycle(actor: { id: string; login: string }): GitHubActor {
  return {
    ...actor,
    avatarUrl: `https://github.com/${encodeURIComponent(actor.login)}.png?size=96`,
    url: `https://github.com/${encodeURIComponent(actor.login)}`,
    kind: "User",
  };
}

function emptyLeader(actor: GitHubActor): MutableGlobalLeader {
  return {
    actor,
    score: 0,
    tokens: 0,
    projectedMinor: 0n,
    paidMinor: 0n,
    cycleKeys: new Set<string>(),
    projectIds: new Set<string>(),
  };
}

function cycleKey(projectId: string, cycleId: string): string {
  return `${projectId}\0${cycleId}`;
}

export function createGlobalLeaders(
  snapshot: LeaderboardSnapshot,
  views: readonly ProjectView[],
  cycleIndex: CycleIndex,
): GlobalLeader[] {
  const currentActors = new Map(
    snapshot.leaders.map((leader) => [leader.actor.id, leader.actor]),
  );
  const byActor = new Map<string, MutableGlobalLeader>();
  const archivedCycleKeys = new Set(
    cycleIndex.cycles.map((cycle) => cycleKey(cycle.projectId, cycle.cycleId)),
  );

  for (const cycle of cycleIndex.cycles) {
    const key = cycleKey(cycle.projectId, cycle.cycleId);
    for (const contributor of cycle.contributors) {
      const actor =
        currentActors.get(contributor.actor.id) ??
        actorFromCycle(contributor.actor);
      const current = byActor.get(actor.id) ?? emptyLeader(actor);
      current.score += contributor.score;
      current.paidMinor += BigInt(contributor.paidMinor);
      if (contributor.score > 0) {
        current.cycleKeys.add(key);
        current.projectIds.add(cycle.projectId);
      }
      byActor.set(actor.id, current);
    }
  }

  for (const event of snapshot.ledger) {
    const project = findProjectByRepositoryId(event.repository);
    if (!project) {
      throw new TypeError(
        `Accepted event ${event.id} references an unregistered project`,
      );
    }
    const key = cycleKey(project.id, event.occurredAt.slice(0, 7));
    if (archivedCycleKeys.has(key)) continue;
    const current = byActor.get(event.actor.id) ?? emptyLeader(event.actor);
    current.actor = event.actor;
    current.score += event.points;
    current.cycleKeys.add(key);
    current.projectIds.add(project.id);
    byActor.set(event.actor.id, current);
  }

  for (const view of views) {
    for (const leader of view.leaders) {
      const current = byActor.get(leader.actor.id) ?? emptyLeader(leader.actor);
      current.actor = leader.actor;
      current.tokens += leader.usage.relevantTokens;
      current.projectedMinor += BigInt(leader.projectedMinor ?? "0");
      byActor.set(leader.actor.id, current);
    }
  }

  return [...byActor.values()]
    .filter(
      (leader) =>
        leader.score > 0 ||
        leader.tokens > 0 ||
        leader.projectedMinor > 0n ||
        leader.paidMinor > 0n,
    )
    .map<GlobalLeader>((leader) => ({
      actor: leader.actor,
      score: leader.score,
      tokens: leader.tokens,
      projectedMinor: leader.projectedMinor,
      paidMinor: leader.paidMinor,
      projects: leader.projectIds.size,
      cycles: leader.cycleKeys.size,
    }))
    .sort(
      (left, right) =>
        right.score - left.score || compareActors(left.actor, right.actor),
    );
}

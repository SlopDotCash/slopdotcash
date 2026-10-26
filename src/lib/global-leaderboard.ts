import { compareActors } from "./github-actor";
/**
 * Builds the cumulative cross-project leaderboard from accepted score events
 * and immutable closed-cycle records. A closed cycle replaces overlapping
 * rolling-window events so its complete score is counted exactly once.
 * Events before a project's reward start are outside every cycle of that
 * project: the cycle leaderboard and the closed record do not count them, so
 * this projection does not count them either.
 */

import type { CycleIndex } from "./cycle-index";
import type { GitHubActor, LeaderboardSnapshot } from "./leaderboard";
import { type ProjectView, requiredProjection } from "./project-view";
import { findIngestedProjectByRepositoryId } from "./projects.mjs";
import { type PenaltyDeductions, penaltyDeductions } from "./score-penalties";

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

function actorFromCycle(actor: { id: string; login: string }): GitHubActor {
  return {
    ...actor,
    avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(actor.login)}?size=96`,
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

function projectOf(repository: string) {
  const project = findIngestedProjectByRepositoryId(repository);
  if (!project)
    throw new TypeError(
      `Score record ${repository} references an unregistered project`,
    );
  return project;
}

/**
 * Rolling-window events and debits of months without a closed cycle record.
 * A closed record already carries its month's score, so a later debit never
 * changes it.
 */
export function openMonthScores(
  snapshot: LeaderboardSnapshot,
  cycleIndex: CycleIndex,
): {
  openEvents: LeaderboardSnapshot["ledger"];
  deductions: PenaltyDeductions;
} {
  const archived = new Set(
    cycleIndex.cycles.map((cycle) => cycleKey(cycle.projectId, cycle.cycleId)),
  );
  const open = (repository: string, occurredAt: string) => {
    const project = projectOf(repository);
    return (
      Date.parse(occurredAt) >= Date.parse(project.reward.rewardStartAt) &&
      !archived.has(cycleKey(project.id, occurredAt.slice(0, 7)))
    );
  };
  const openEvents = snapshot.ledger.filter((event) =>
    open(event.repository, event.occurredAt),
  );
  return {
    openEvents,
    deductions: penaltyDeductions(
      openEvents,
      (snapshot.penalties ?? []).filter((penalty) =>
        open(penalty.repository, penalty.occurredAt),
      ),
      (repository) => projectOf(repository).id,
    ),
  };
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

  for (const cycle of cycleIndex.cycles) {
    const key = cycleKey(cycle.projectId, cycle.cycleId);
    for (const contributor of cycle.contributors) {
      const actor =
        currentActors.get(contributor.actor.id) ??
        actorFromCycle(contributor.actor);
      const current = byActor.get(actor.id) ?? emptyLeader(actor);
      current.score += contributor.scoreThirds ?? contributor.score * 3;
      current.paidMinor += BigInt(contributor.paidMinor);
      if (
        (contributor.scoreThirds ?? contributor.score * 3) > 0 ||
        contributor.state !== "excluded"
      ) {
        current.cycleKeys.add(key);
        current.projectIds.add(cycle.projectId);
      }
      byActor.set(actor.id, current);
    }
  }

  const { openEvents, deductions } = openMonthScores(snapshot, cycleIndex);
  for (const event of openEvents) {
    const project = projectOf(event.repository);
    const key = cycleKey(project.id, event.occurredAt.slice(0, 7));
    const current = byActor.get(event.actor.id) ?? emptyLeader(event.actor);
    current.actor = event.actor;
    current.score += event.scoreThirds ?? Math.round(event.points * 3);
    current.cycleKeys.add(key);
    current.projectIds.add(project.id);
    byActor.set(event.actor.id, current);
  }
  for (const [actorId, thirds] of deductions.byActor) {
    const current = byActor.get(actorId);
    if (current) current.score -= thirds;
  }

  for (const view of views) {
    for (const leader of view.leaders) {
      const current = byActor.get(leader.actor.id) ?? emptyLeader(leader.actor);
      current.actor = leader.actor;
      current.tokens += leader.usage.relevantTokens;
      if (view.reward.kind === "monthly-pool")
        current.projectedMinor += BigInt(
          requiredProjection(leader.projectedMinor, "amount"),
        );
      byActor.set(leader.actor.id, current);
    }
  }

  return [...byActor.values()]
    .filter(
      (leader) =>
        leader.score > 0 ||
        leader.tokens > 0 ||
        leader.projectedMinor > 0n ||
        leader.paidMinor > 0n ||
        leader.cycleKeys.size > 0,
    )
    .map<GlobalLeader>((leader) => ({
      actor: leader.actor,
      score: leader.score / 3,
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

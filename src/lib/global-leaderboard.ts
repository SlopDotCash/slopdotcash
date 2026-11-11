import { compareActors } from "./github-actor";
import type { ActorRef } from "./leaderboard-types";
/**
 * Builds the cumulative cross-project leaderboard from accepted score events
 * and immutable closed-cycle records. A closed cycle replaces overlapping
 * rolling-window events for the actors it lists, so each listed actor's
 * complete score is counted exactly once. An actor the cycle does not list
 * keeps counting through the rolling window: the cycle record carries no
 * score for them, so suppressing their events would count them zero times.
 * Events before a project's reward start are outside every cycle of that
 * project: the cycle leaderboard and the closed record do not count them, so
 * this projection does not count them either.
 */

import type { CycleIndex } from "./cycle-index";
import type { GitHubActor, LeaderboardSnapshot } from "./leaderboard";
import { type ProjectView, requiredProjection } from "./project-view";
import { findIngestedProjectByRepositoryId } from "./projects.mjs";
import {
  eventThirds,
  type PenaltyDeductions,
  penaltyDeductions,
} from "./score-penalties";
import {
  type GlobalJoinRow,
  openSourceIndices,
  planGlobalJoin,
} from "./verified-global-joins.ts";

interface GlobalLeader {
  actor: GitHubActor;
  score: number;
  tokens: number;
  projectedMinor: bigint;
  paidMinor: bigint;
  projects: number;
  cycles: number;
}

function actorFromCycle(actor: ActorRef): GitHubActor {
  return {
    ...actor,
    avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(actor.login)}?size=96`,
    url: `https://github.com/${encodeURIComponent(actor.login)}`,
    kind: "User",
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
 * Rolling-window events and debits of months without a closed cycle record
 * for that actor. A closed record already carries its listed actors' scores,
 * so a later debit never changes them. An actor the cycle does not list has
 * no score in that record, so their events and debits stay open.
 */
export function openMonthScores(
  snapshot: LeaderboardSnapshot,
  cycleIndex: CycleIndex,
): {
  openEvents: LeaderboardSnapshot["ledger"];
  deductions: PenaltyDeductions;
} {
  const scopes = new Map<string, number>();
  const archived: boolean[] = [];
  const scopeIndex = (key: string) => {
    const found = scopes.get(key);
    if (found !== undefined) return found;
    const index = scopes.size;
    scopes.set(key, index);
    archived.push(false);
    return index;
  };
  const actorScope = (projectId: string, cycleId: string, actorId: string) =>
    `${cycleKey(projectId, cycleId)}\0${actorId}`;
  for (const cycle of cycleIndex.cycles)
    for (const contributor of cycle.contributors)
      archived[
        scopeIndex(
          actorScope(cycle.projectId, cycle.cycleId, contributor.actor.id),
        )
      ] = true;
  const select = <
    T extends { repository: string; occurredAt: string; actor: { id: string } },
  >(
    records: readonly T[],
  ): T[] => {
    const rows = records.map((record) => {
      const project = projectOf(record.repository);
      return {
        afterStart:
          Date.parse(record.occurredAt) >=
          Date.parse(project.reward.rewardStartAt),
        scope: scopeIndex(
          actorScope(
            project.id,
            record.occurredAt.slice(0, 7),
            record.actor.id,
          ),
        ),
      };
    });
    return openSourceIndices(rows, archived).map((index) => records[index]);
  };
  const openEvents = select(snapshot.ledger);
  return {
    openEvents,
    deductions: penaltyDeductions(
      openEvents,
      select(snapshot.penalties ?? []),
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
  type Row = {
    kind: "cycle" | "event" | "deduction" | "view";
    actor?: GitHubActor;
    score: number;
    tokens: number;
    paid: bigint;
    projected: bigint;
  };
  const rows: Row[] = [];
  const indexed: GlobalJoinRow[] = [];
  const actors = new Map<string, number>();
  const projects = new Map<number, Map<string, number>>();
  const cycles = new Map<number, Map<string, number>>();
  let projectCount = 0,
    cycleCount = 0;
  const actorIndex = (id: string) => {
    const found = actors.get(id);
    if (found !== undefined) return found;
    const next = actors.size;
    actors.set(id, next);
    return next;
  };
  const membership = (
    map: Map<number, Map<string, number>>,
    actor: number,
    key: string,
    cycle: boolean,
  ) => {
    let keys = map.get(actor);
    if (!keys) {
      keys = new Map();
      map.set(actor, keys);
    }
    const found = keys.get(key);
    if (found !== undefined) return found;
    const next = cycle ? cycleCount++ : projectCount++;
    keys.set(key, next);
    return next;
  };
  const append = (
    row: Row,
    actor: number,
    project: string | null = null,
    cycle: string | null = null,
  ) => {
    rows.push(row);
    indexed.push({
      actor,
      project:
        project === null ? -1 : membership(projects, actor, project, false),
      cycle: cycle === null ? -1 : membership(cycles, actor, cycle, true),
      kind: row.kind,
    });
  };
  for (const cycle of cycleIndex.cycles) {
    const key = cycleKey(cycle.projectId, cycle.cycleId);
    for (const contributor of cycle.contributors) {
      const actor =
        currentActors.get(contributor.actor.id) ??
        actorFromCycle(contributor.actor);
      const score = contributor.scoreThirds ?? contributor.score * 3;
      const paid = BigInt(contributor.paidMinor);
      const counted = score > 0 || contributor.state !== "excluded";
      append(
        { kind: "cycle", actor, score, paid, tokens: 0, projected: 0n },
        actorIndex(actor.id),
        counted ? cycle.projectId : null,
        counted ? key : null,
      );
    }
  }
  const { openEvents, deductions } = openMonthScores(snapshot, cycleIndex);
  for (const event of openEvents) {
    const project = projectOf(event.repository);
    append(
      {
        kind: "event",
        actor: event.actor,
        score: eventThirds(event),
        tokens: 0,
        paid: 0n,
        projected: 0n,
      },
      actorIndex(event.actor.id),
      project.id,
      cycleKey(project.id, event.occurredAt.slice(0, 7)),
    );
  }
  for (const [actorId, thirds] of deductions.byActor)
    append(
      { kind: "deduction", score: thirds, tokens: 0, paid: 0n, projected: 0n },
      actors.get(actorId) ?? -1,
    );
  for (const view of views) {
    for (const leader of view.leaders) {
      const projected =
        view.reward.kind === "monthly-pool"
          ? BigInt(requiredProjection(leader.projectedMinor, "amount"))
          : 0n;
      append(
        {
          kind: "view",
          actor: leader.actor,
          score: 0,
          tokens: leader.usage.relevantTokens,
          paid: 0n,
          projected,
        },
        actorIndex(leader.actor.id),
      );
    }
  }
  const plan = planGlobalJoin(indexed, actors.size, projectCount, cycleCount);
  const result: GlobalLeader[] = [];
  for (let actor = 0; actor < actors.size; actor++) {
    let score = 0,
      tokens = 0,
      projectedMinor = 0n,
      paidMinor = 0n;
    for (let index = plan.first[actor]; index >= 0; index = plan.next[index]) {
      const row = rows[index];
      if (row.kind === "cycle") {
        score += row.score;
        paidMinor += row.paid;
      } else if (row.kind === "event") score += row.score;
      else if (row.kind === "deduction") score -= row.score;
      else {
        tokens += row.tokens;
        projectedMinor += row.projected;
      }
    }
    if (
      score > 0 ||
      tokens > 0 ||
      projectedMinor > 0n ||
      paidMinor > 0n ||
      plan.cycles[actor] > 0
    )
      result.push({
        actor: rows[plan.actorSource[actor]].actor as GitHubActor,
        score: score / 3,
        tokens,
        projectedMinor,
        paidMinor,
        projects: plan.projects[actor],
        cycles: plan.cycles[actor],
      });
  }
  return result.sort(
    (left, right) =>
      right.score - left.score || compareActors(left.actor, right.actor),
  );
}

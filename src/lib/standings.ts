/**
 * The small standings record that the publication builds beside the full
 * leaderboard snapshot. The contributor and project pages show only a
 * handful of values from the snapshot: the current leaders, every actor the
 * snapshot names, each project's cycle leaders, the global leader set and the
 * applied penalties. Publishing those values lets the pages skip the complete
 * multi-megabyte ledger (PRD section 9: public pages serve published
 * snapshots). The same functions that the pages used to run in the browser
 * compute every value here, so the rendered output does not change.
 */
import type { CycleIndex } from "./cycle-index";
import { createGlobalLeaders, openMonthScores } from "./global-leaderboard";
import {
  GITHUB_ACTOR_KINDS,
  type GitHubActor,
  type LeaderboardSnapshot,
  type PublishedPenalty,
} from "./leaderboard-types";
import { createProjectView, projectCycleHasOpened } from "./project-view";
import { PROJECTS } from "./projects.mjs";

export const STANDINGS_FORMAT = "slop-standings-v1";
export const MAX_STANDINGS_BYTES = 4 * 1024 * 1024;

/** An identity source for a profile login, in the snapshot's own order. */
export interface StandingsActor {
  id: string;
  login: string;
  avatarUrl: string;
}

export interface ProjectStandingLeader {
  actorId: string;
  score: number;
  scoreThirds: number;
  adjustedWeight: number;
}

/** One project's current cycle leaders, in the project view's rank order. */
export interface ProjectStanding {
  projectId: string;
  cycleId: string;
  leaders: ProjectStandingLeader[];
}

export interface StandingsPenalty extends PublishedPenalty {
  /** Open-month thirds actually deducted for this penalty. */
  appliedThirds: number;
}

export interface PublishedStandings {
  format: typeof STANDINGS_FORMAT;
  generatedAt: string;
  /** SHA-256 of the logical leaderboard snapshot these values came from. */
  snapshotDigest: string;
  /** The snapshot's current leaders, which name each ranked actor. */
  leaders: { actor: GitHubActor }[];
  /** Review-exclusion reviewers, project leaders and opportunity actors. */
  actors: StandingsActor[];
  projects: ProjectStanding[];
  /** Actors with a cumulative cross-project leader row. */
  globalLeaderIds: string[];
  penalties: StandingsPenalty[];
}

const DIGEST = /^[a-f0-9]{64}$/u;

/** The project views the pages build from a snapshot, in registry order. */
export function standingProjectIds(snapshot: LeaderboardSnapshot): string[] {
  return PROJECTS.filter(
    (project) =>
      projectCycleHasOpened(snapshot, project.id) &&
      project.repositories.every((repository) =>
        snapshot.repositories.some(
          (collected) => collected.id === repository.id,
        ),
      ),
  ).map((project) => project.id);
}

export function createPublishedStandings(
  snapshot: LeaderboardSnapshot,
  cycleIndex: CycleIndex,
  snapshotDigest: string,
): PublishedStandings {
  if (!DIGEST.test(snapshotDigest))
    throw new TypeError("Standings need the snapshot digest");
  const views = standingProjectIds(snapshot).map((projectId) =>
    createProjectView(snapshot, projectId),
  );
  // The profile page resolves a login against these sources in this order.
  // Only the first entry of each (id, login) pair can decide a lookup, and a
  // conflict check needs each pair once, so later repeats are dropped.
  const seen = new Set<string>();
  const actors: StandingsActor[] = [];
  const addActor = (actor: GitHubActor) => {
    const key = `${actor.id}\0${actor.login}`;
    if (seen.has(key)) return;
    seen.add(key);
    actors.push({
      id: actor.id,
      login: actor.login,
      avatarUrl: actor.avatarUrl,
    });
  };
  for (const exclusion of snapshot.reviewExclusions ?? [])
    if (exclusion.reviewer?.kind === "User") addActor(exclusion.reviewer);
  for (const view of views) {
    for (const leader of view.leaders) addActor(leader.actor);
    for (const opportunity of view.opportunities) addActor(opportunity.actor);
  }
  const { deductions } = openMonthScores(snapshot, cycleIndex);
  return {
    format: STANDINGS_FORMAT,
    generatedAt: snapshot.generatedAt,
    snapshotDigest,
    leaders: snapshot.leaders.map(({ actor }) => ({ actor })),
    actors,
    projects: views.map((view) => ({
      projectId: view.project.id,
      cycleId: view.cycle.id,
      leaders: view.leaders.map((leader) => ({
        actorId: leader.actor.id,
        score: leader.score,
        scoreThirds: leader.scoreThirds,
        adjustedWeight: leader.adjustedWeight,
      })),
    })),
    globalLeaderIds: createGlobalLeaders(snapshot, views, cycleIndex).map(
      (leader) => leader.actor.id,
    ),
    penalties: (snapshot.penalties ?? []).map((penalty) => ({
      ...penalty,
      appliedThirds: deductions.byPenalty.get(penalty.id) ?? 0,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

/** The UTC ISO-8601 forms the leaderboard snapshot itself accepts. */
function isIso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

function isActor(value: unknown): value is GitHubActor {
  return (
    isRecord(value) &&
    exactKeys(value, ["id", "login", "avatarUrl", "url", "kind"]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.login === "string" &&
    value.login.length > 0 &&
    typeof value.avatarUrl === "string" &&
    typeof value.url === "string" &&
    (GITHUB_ACTOR_KINDS as readonly unknown[]).includes(value.kind)
  );
}

function isStandingsActor(value: unknown): value is StandingsActor {
  return (
    isRecord(value) &&
    exactKeys(value, ["id", "login", "avatarUrl"]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.login === "string" &&
    value.login.length > 0 &&
    typeof value.avatarUrl === "string"
  );
}

function isLeader(value: unknown): value is ProjectStandingLeader {
  return (
    isRecord(value) &&
    exactKeys(value, ["actorId", "score", "scoreThirds", "adjustedWeight"]) &&
    typeof value.actorId === "string" &&
    value.actorId.length > 0 &&
    Number.isFinite(value.score) &&
    Number.isSafeInteger(value.scoreThirds) &&
    Number.isFinite(value.adjustedWeight)
  );
}

function isProjectStanding(value: unknown): value is ProjectStanding {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["projectId", "cycleId", "leaders"]) ||
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    typeof value.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value.cycleId) ||
    !Array.isArray(value.leaders) ||
    !value.leaders.every(isLeader)
  )
    return false;
  const ids = new Set(value.leaders.map((leader) => leader.actorId));
  return ids.size === value.leaders.length;
}

function isPenalty(value: unknown): value is StandingsPenalty {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "id",
      "actor",
      "repository",
      "occurredAt",
      "category",
      "tableVersion",
      "debitThirds",
      "source",
      "appliedThirds",
    ]) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    !isActor(value.actor) ||
    typeof value.repository !== "string" ||
    !isIso(value.occurredAt) ||
    typeof value.category !== "string" ||
    typeof value.tableVersion !== "string" ||
    !Number.isSafeInteger(value.debitThirds) ||
    (value.debitThirds as number) < 0 ||
    !Number.isSafeInteger(value.appliedThirds) ||
    (value.appliedThirds as number) < 0 ||
    (value.appliedThirds as number) > (value.debitThirds as number) ||
    !isRecord(value.source) ||
    !exactKeys(value.source, ["id", "kind", "number", "title", "url"])
  )
    return false;
  const source = value.source;
  return (
    typeof source.id === "string" &&
    source.kind === "pull-request" &&
    Number.isSafeInteger(source.number) &&
    typeof source.title === "string" &&
    typeof source.url === "string"
  );
}

/** Rejects any published standings that do not match this build's contract. */
export function assertPublishedStandings(
  value: unknown,
): asserts value is PublishedStandings {
  if (
    !isRecord(value) ||
    value.format !== STANDINGS_FORMAT ||
    !exactKeys(value, [
      "format",
      "generatedAt",
      "snapshotDigest",
      "leaders",
      "actors",
      "projects",
      "globalLeaderIds",
      "penalties",
    ]) ||
    !isIso(value.generatedAt) ||
    typeof value.snapshotDigest !== "string" ||
    !DIGEST.test(value.snapshotDigest) ||
    !Array.isArray(value.leaders) ||
    !value.leaders.every(
      (leader) =>
        isRecord(leader) &&
        exactKeys(leader, ["actor"]) &&
        isActor(leader.actor),
    ) ||
    !Array.isArray(value.actors) ||
    !value.actors.every(isStandingsActor) ||
    !Array.isArray(value.projects) ||
    !value.projects.every(isProjectStanding) ||
    new Set(value.projects.map((project) => project.projectId)).size !==
      value.projects.length ||
    !Array.isArray(value.globalLeaderIds) ||
    !value.globalLeaderIds.every(
      (id) => typeof id === "string" && id.length > 0,
    ) ||
    new Set(value.globalLeaderIds).size !== value.globalLeaderIds.length ||
    !Array.isArray(value.penalties) ||
    !value.penalties.every(isPenalty) ||
    new Set(value.penalties.map((penalty) => penalty.id)).size !==
      value.penalties.length
  )
    throw new Error("Invalid published standings");
}

// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/points/penalties.md, "Standing is the month's accepted-work credits minus active debits, never below zero, whatever the order"
import { compareCodeUnits, eventThirds, type GitHubActor, type LeaderboardSnapshot, type PenaltyDeductions, penaltyDeductions, pointsOf, type PublishedPenalty, type RepositoryRegistry, registryOf, type ScoreEvent } from "@repo/points/client";
import { parsePeriod } from "@repo/settlement/kernels/calendar";
import { pointsFor, rankAt, type StandingEntry } from "../../gen/frontend__projections.ts";
import { compareActors, type ProjectCycleView, type ProjectTerms } from "./projectView.ts";

export interface Standing {
  readonly actor: number;
  readonly points: number;
  readonly rank: number;
}

export interface ClosedCycleContributor {
  readonly actor: { readonly id: string; readonly login: string };
  readonly score: number;
  readonly scoreThirds?: number;
  readonly state: string;
  readonly paidMinor: string;
}

export interface ClosedCycle {
  readonly projectId: string;
  readonly cycleId: string;
  readonly contributors: ReadonlyArray<ClosedCycleContributor>;
}

export interface GlobalStanding {
  readonly rank: number;
  readonly actor: GitHubActor;
  readonly points: number;
  readonly tokens: number;
  readonly projectedMinor: bigint;
  readonly paidMinor: bigint;
  readonly projects: number;
  readonly cycles: number;
}

export interface ReviewerStanding {
  readonly rank: number;
  readonly actor: GitHubActor;
  readonly reviewPoints: number;
  readonly reviewEventCount: number;
}

export interface GlobalRequest {
  readonly snapshot: LeaderboardSnapshot;
  readonly registry: RepositoryRegistry;
  readonly projects: ReadonlyArray<ProjectTerms>;
  readonly views: ReadonlyArray<ProjectCycleView>;
  readonly cycles: ReadonlyArray<ClosedCycle>;
}

export interface StandingHistory {
  readonly actors: ReadonlyArray<GitHubActor>;
  readonly entries: ReadonlyArray<StandingEntry>;
}

interface Tally {
  readonly index: number;
  actor: GitHubActor;
  tokens: number;
  projectedMinor: bigint;
  paidMinor: bigint;
  readonly projects: Set<string>;
  readonly cycles: Set<string>;
}

const cycleKey = (projectId: string, cycleId: string) => `${projectId}\0${cycleId}`;

function periodOf(month: string): number {
  const period = parsePeriod(month);
  if (period === undefined) throw new RangeError(`Invalid contribution period: ${month}`);
  return period;
}

/** @throws {never} */
export function standingsFor(entries: ReadonlyArray<StandingEntry>, period: number): ReadonlyArray<Standing> {
  const rows = [...entries];
  const scored = [...new Set(rows.map((entry) => entry.actor))].map((actor) => ({ actor, points: pointsFor(rows, actor, period) })).filter((row) => row.points > 0);
  const totals = scored.map((row) => row.points);
  return scored.map((row) => ({ ...row, rank: rankAt(totals, row.points) })).sort((left, right) => right.points - left.points || left.actor - right.actor);
}

function actorFromCycle(actor: { readonly id: string; readonly login: string }): GitHubActor {
  const login = encodeURIComponent(actor.login);
  return { id: actor.id, login: actor.login, avatarUrl: `https://avatars.githubusercontent.com/${login}?size=96`, url: `https://github.com/${login}`, kind: "User" };
}

function projectOfRepository(request: GlobalRequest): (repository: string) => ProjectTerms {
  const registry = registryOf(request.registry);
  const terms = new Map(request.projects.map((project) => [project.id, project]));
  return (repository) => {
    const project = terms.get(registry.byId.get(repository.toLowerCase())?.projectId ?? "");
    if (project === undefined) throw new RangeError(`Score record ${repository} references an unregistered project`);
    return project;
  };
}

function counts(project: ProjectTerms, record: { readonly repository: string; readonly occurredAt: string }): boolean {
  const at = Date.parse(record.occurredAt);
  const wanted = record.repository.toLowerCase();
  const countsFrom = project.repositories.find((repository) => repository.id.toLowerCase() === wanted)?.countsFrom;
  return at >= Date.parse(project.rewardStartAt) && at >= (countsFrom === undefined ? 0 : Date.parse(countsFrom));
}

/** @throws {RangeError} */
export function openMonthScores(request: GlobalRequest): { readonly events: ReadonlyArray<ScoreEvent>; readonly penalties: ReadonlyArray<PublishedPenalty>; readonly deductions: PenaltyDeductions } {
  const projectOf = projectOfRepository(request);
  const archived = new Set(request.cycles.map((cycle) => cycleKey(cycle.projectId, cycle.cycleId)));
  const open = <T extends { readonly repository: string; readonly occurredAt: string }>(records: ReadonlyArray<T>) =>
    records.filter((record) => {
      const project = projectOf(record.repository);
      return counts(project, record) && !archived.has(cycleKey(project.id, record.occurredAt.slice(0, 7)));
    });
  const events = open(request.snapshot.ledger);
  const penalties = open(request.snapshot.penalties ?? []);
  return { events, penalties, deductions: penaltyDeductions(registryOf(request.registry), events, penalties) };
}

function talliesOf(request: GlobalRequest): { readonly tallies: ReadonlyArray<Tally>; readonly entries: ReadonlyArray<StandingEntry> } {
  const projectOf = projectOfRepository(request);
  const current = new Map(request.snapshot.leaders.map((leader) => [leader.actor.id, leader.actor]));
  const tallies = new Map<string, Tally>();
  const tally = (actor: GitHubActor, source: "cycle" | "current") => {
    const known = tallies.get(actor.id);
    if (known === undefined) {
      const created: Tally = { index: tallies.size, actor, tokens: 0, projectedMinor: 0n, paidMinor: 0n, projects: new Set(), cycles: new Set() };
      tallies.set(actor.id, created);
      return created;
    }
    if (source === "current") known.actor = actor;
    return known;
  };
  const buckets = new Map<string, StandingEntry>();
  const credit = (entry: Tally, month: string, points: number) => {
    const period = periodOf(month);
    const key = `${entry.index}\0${period}`;
    buckets.set(key, { actor: entry.index, period, points: (buckets.get(key)?.points ?? 0) + points });
  };
  for (const cycle of request.cycles) {
    for (const row of cycle.contributors) {
      const entry = tally(current.get(row.actor.id) ?? actorFromCycle(row.actor), "cycle");
      const thirds = row.scoreThirds ?? row.score * 3;
      credit(entry, cycle.cycleId, pointsOf(thirds));
      entry.paidMinor += BigInt(row.paidMinor);
      if (thirds > 0 || row.state !== "excluded") {
        entry.projects.add(cycle.projectId);
        entry.cycles.add(cycleKey(cycle.projectId, cycle.cycleId));
      }
    }
  }
  const { events, penalties, deductions } = openMonthScores(request);
  for (const event of events) {
    const project = projectOf(event.repository);
    const month = event.occurredAt.slice(0, 7);
    const entry = tally(event.actor, "current");
    credit(entry, month, pointsOf(eventThirds(event)));
    entry.projects.add(project.id);
    entry.cycles.add(cycleKey(project.id, month));
  }
  for (const penalty of penalties) {
    const applied = deductions.byPenalty.get(penalty.id);
    const entry = tallies.get(penalty.actor.id);
    if (applied !== undefined && entry !== undefined) credit(entry, penalty.occurredAt.slice(0, 7), -pointsOf(applied));
  }
  for (const view of request.views) {
    for (const leader of view.leaders) tally(leader.actor, "current").tokens += leader.usage.relevantTokens;
    if (view.kind === "monthly-pool") for (const leader of view.leaders) tally(leader.actor, "current").projectedMinor += leader.projectedMinor;
  }
  return { tallies: [...tallies.values()], entries: [...buckets.values()] };
}

/** @throws {RangeError} */
export function standingHistory(request: GlobalRequest): StandingHistory {
  const { tallies, entries } = talliesOf(request);
  return { actors: tallies.map((entry) => entry.actor), entries };
}

/** @throws {RangeError} */
export function globalStandings(request: GlobalRequest): ReadonlyArray<GlobalStanding> {
  const { tallies, entries } = talliesOf(request);
  const standings = new Map(standingsFor(entries, 0).map((standing) => [standing.actor, standing]));
  const unranked = rankAt([...standings.values()].map((standing) => standing.points), 0);
  return tallies
    .map((entry) => ({ entry, standing: standings.get(entry.index) }))
    .filter(({ entry, standing }) => standing !== undefined || entry.tokens > 0 || entry.projectedMinor > 0n || entry.paidMinor > 0n || entry.cycles.size > 0)
    .map(({ entry, standing }) => ({ rank: standing?.rank ?? unranked, actor: entry.actor, points: standing?.points ?? 0, tokens: entry.tokens, projectedMinor: entry.projectedMinor, paidMinor: entry.paidMinor, projects: entry.projects.size, cycles: entry.cycles.size }))
    .sort((left, right) => right.points - left.points || compareActors(left.actor, right.actor));
}

/** @throws {never} */
export function reviewerStandings(ledger: ReadonlyArray<ScoreEvent>): ReadonlyArray<ReviewerStanding> {
  const byActor = new Map<string, { actor: GitHubActor; reviewPoints: number; reviewEventCount: number }>();
  for (const event of ledger) {
    if (event.category !== "substantive-review") continue;
    const entry = byActor.get(event.actor.id) ?? { actor: event.actor, reviewPoints: 0, reviewEventCount: 0 };
    byActor.set(event.actor.id, { actor: event.actor, reviewPoints: entry.reviewPoints + pointsOf(eventThirds(event)), reviewEventCount: entry.reviewEventCount + 1 });
  }
  const reviewers = [...byActor.values()].filter((entry) => entry.reviewPoints > 0);
  const totals = reviewers.map((entry) => entry.reviewPoints);
  return reviewers
    .sort((left, right) => right.reviewPoints - left.reviewPoints || compareCodeUnits(left.actor.id, right.actor.id))
    .map((entry) => ({ rank: rankAt(totals, entry.reviewPoints), ...entry }));
}

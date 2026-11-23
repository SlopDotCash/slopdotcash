// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/points/journal.md, "Public totals are views of the latest revisions, with penalties bounded by the month's credit"
import { parsePeriod } from "@repo/settlement/kernels/calendar";
import type { StandingEntry } from "../../../gen/frontend__projections.ts";
import { standingsFor } from "../../projections/standings.ts";
import type { DatedAward } from "../../projections/profile.ts";

export interface JournalActor {
  readonly id: string;
  readonly login: string;
}

export interface JournalRow {
  readonly recordedAt: string;
  readonly award: {
    readonly key: string;
    readonly actor: JournalActor;
    readonly projectId: string;
    readonly category: string;
    readonly amount: number;
    readonly occurredAt: string;
  };
  readonly decision?: { readonly sourceId: string };
}

export interface JournalRows {
  readonly generatedAt: string;
  readonly revisions: ReadonlyArray<JournalRow>;
}

export interface MemberHistory {
  readonly actor: JournalActor;
  readonly awards: ReadonlyArray<DatedAward>;
}

export interface StandingHistory {
  readonly members: ReadonlyArray<MemberHistory>;
  readonly entries: ReadonlyArray<StandingEntry>;
}

export interface StandingRow {
  readonly rank: number;
  readonly actor: JournalActor;
  readonly points: number;
}

export type Period = "month" | "lifetime";

const penalty = "slopbot-penalty";
const acceptedWork = new Set(["merged-pull-request", "resolved-issue", "material-test-change", "substantive-review", "evaluated-contribution"]);

/** @throws {never} */
function counted(row: JournalRow): boolean {
  return row.award.amount === 0 ? row.decision?.sourceId.startsWith("value:") === true : row.award.category !== penalty;
}

/** @throws {RangeError} */
function periodOf(occurredAt: string): number {
  const period = parsePeriod(occurredAt.slice(0, 7));
  if (period === undefined) throw new RangeError(`Invalid contribution period: ${occurredAt}`);
  return period;
}

/** @throws {RangeError} */
function exact(points: number): number {
  if (!Number.isSafeInteger(points)) throw new RangeError("Points total overflow");
  return points;
}

/** @throws {never} */
function boundedDebit(credit: number, requested: number): number {
  return credit <= 0 ? 0 : requested < credit ? requested : credit;
}

/** The latest revision of every award, summed per member and UTC month with each project's penalties bounded by that month's accepted-work credit; only `projectId`'s awards when one is given. @throws {RangeError} */
export function standingHistory(journal: JournalRows, projectId?: string): StandingHistory {
  const latest = new Map<string, JournalRow>();
  for (const row of journal.revisions) latest.set(row.award.key, row);
  const named = new Map<string, JournalRow>();
  for (const row of journal.revisions) {
    if (row.award.category === penalty) continue;
    const prior = named.get(row.award.actor.id);
    if (prior === undefined || row.recordedAt >= prior.recordedAt) named.set(row.award.actor.id, row);
  }
  const rows = [...latest.values()].filter((row) => projectId === undefined || row.award.projectId === projectId);
  const numbers = new Map<string, number>();
  const awards = new Map<string, DatedAward[]>();
  const credits = new Map<string, { readonly actorId: string; readonly period: number; earned: number; credit: number; requested: number }>();
  for (const row of rows) {
    const { actor, projectId: project, category, amount, occurredAt } = row.award;
    if (counted(row) && !numbers.has(actor.id)) numbers.set(actor.id, numbers.size);
    const period = periodOf(occurredAt);
    const key = `${actor.id}\0${project}\0${period}`;
    const bucket = credits.get(key) ?? { actorId: actor.id, period, earned: 0, credit: 0, requested: 0 };
    if (category === penalty) bucket.requested = exact(bucket.requested - amount);
    else bucket.earned = exact(bucket.earned + amount);
    if (acceptedWork.has(category)) bucket.credit = exact(bucket.credit + amount);
    credits.set(key, bucket);
    if (amount !== 0) awards.set(actor.id, [...(awards.get(actor.id) ?? []), { occurredAt, amount }]);
  }
  const entries = new Map<string, StandingEntry>();
  for (const bucket of credits.values()) {
    const actor = numbers.get(bucket.actorId);
    if (actor === undefined) continue;
    const points = exact(bucket.earned - boundedDebit(bucket.credit, bucket.requested));
    const slot = `${actor}\0${bucket.period}`;
    entries.set(slot, { actor, period: bucket.period, points: exact((entries.get(slot)?.points ?? 0) + points) });
  }
  const members = [...numbers.keys()].map((id) => ({
    actor: named.get(id)?.award.actor ?? rows.find((row) => row.award.actor.id === id)?.award.actor ?? { id, login: "" },
    awards: [...(awards.get(id) ?? [])].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
  }));
  return { members, entries: [...entries.values()] };
}

/** The UTC contribution period of `nowMs`. @throws {RangeError} */
export function currentPeriod(nowMs: number): number {
  return periodOf(new Date(nowMs).toISOString());
}

/** Members with points in the period, equal totals sharing a rank; ties ordered by actor id. @throws {RangeError} */
export function standingRows(history: StandingHistory, period: Period, nowMs: number): ReadonlyArray<StandingRow> {
  return standingsFor(history.entries, period === "lifetime" ? 0 : currentPeriod(nowMs))
    .flatMap((standing) => {
      const member = history.members[standing.actor];
      return member === undefined ? [] : [{ rank: standing.rank, actor: member.actor, points: standing.points }];
    })
    .sort((left, right) => right.points - left.points || left.actor.id.localeCompare(right.actor.id));
}

/** Rows whose login contains the query, ignoring case. @throws {never} */
export function matching<T>(rows: ReadonlyArray<T>, query: string, loginOf: (row: T) => string): ReadonlyArray<T> {
  const wanted = query.toLowerCase();
  return rows.filter((row) => loginOf(row).toLowerCase().includes(wanted));
}

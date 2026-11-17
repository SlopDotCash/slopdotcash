// spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login"; spec/frontend/views.md, "Recent Points sum each UTC day of the last days including today"
import { type JournalRecord, type MemberRecord, type ProfileSource, recentPoints as recentTotal, resolveProfileActor as resolved } from "../../gen/frontend__views.ts";

export interface ProfileActorSource {
  readonly id: string;
  readonly login: string;
  readonly avatarUrl?: string;
}

export interface ProfileActor {
  readonly id: string;
  readonly login: string;
  readonly avatarUrl: string;
  readonly url: string;
  readonly kind: "User";
}

export interface ProfileSources {
  readonly login: string;
  readonly actors: ReadonlyArray<ProfileActorSource>;
  readonly people: ReadonlyArray<ProfileActorSource>;
  readonly member: ProfileActorSource | null;
  readonly journal: ReadonlyArray<ProfileActorSource> | null;
}

export interface DatedAward {
  readonly occurredAt: string;
  readonly amount: number;
}

export interface DayPoints {
  readonly day: string;
  readonly points: number;
}

const dayMs = 86_400_000;

/** @throws {never} */
function asActor(source: ProfileActorSource): ProfileActor {
  return {
    id: source.id,
    login: source.login,
    avatarUrl: source.avatarUrl ?? `https://avatars.githubusercontent.com/${encodeURIComponent(source.login)}?size=160`,
    url: `https://github.com/${encodeURIComponent(source.login)}`,
    kind: "User",
  };
}

/** @throws {never} */
export function resolveProfileActor({ login, actors, people, member, journal }: ProfileSources): ProfileActor | undefined {
  const numbers = new Map<string, number>();
  const named = new Map<number, ProfileActorSource>();
  const numbered = (source: ProfileActorSource): ProfileSource => {
    const id = numbers.get(source.id) ?? numbers.size + 1;
    numbers.set(source.id, id);
    if (!named.has(id)) named.set(id, source);
    return { id, login: source.login.toLowerCase() };
  };
  const currentActors = actors.map(numbered);
  const directory = people.map(numbered);
  const memberRecord: MemberRecord = member === null ? { tag: "NoMember" } : (() => {
    const found = numbered(member);
    named.set(found.id, member);
    return { tag: "MemberFound", memberId: found.id, memberLogin: found.login };
  })();
  const journalRecord: JournalRecord = journal === null ? { tag: "JournalPending" } : { tag: "JournalLoaded", entries: journal.map(numbered) };
  const id = resolved(login.toLowerCase(), currentActors, directory, memberRecord, journalRecord);
  const source = id > 0 ? named.get(id) : undefined;
  return source === undefined ? undefined : asActor(source);
}

/** @throws {never} */
function dayNumber(millis: number): number {
  return Math.floor(millis / dayMs);
}

/** @throws {RangeError} */
function dayText(day: number): string {
  return new Date(day * dayMs).toISOString().slice(0, 10);
}

/** @throws {RangeError} */
export function dailyPoints(awards: ReadonlyArray<DatedAward>, todayMs: number, days: number): ReadonlyArray<DayPoints> {
  const today = dayNumber(todayMs);
  const dated = awardsOn(awards);
  const window = Array.from({ length: Math.max(0, days) }, (_, index) => today - (days - 1 - index));
  return window.map((day) => ({ day: dayText(day), points: recentTotal(dated, day, 1) }));
}

/** @throws {never} */
function awardsOn(awards: ReadonlyArray<DatedAward>): Array<{ day: number; amount: number }> {
  return awards.flatMap((award) => {
    const millis = Date.parse(award.occurredAt.slice(0, 10));
    return Number.isFinite(millis) ? [{ day: dayNumber(millis), amount: award.amount }] : [];
  });
}

/** @throws {never} */
export function recentPoints(awards: ReadonlyArray<DatedAward>, todayMs: number, days: number): number {
  return recentTotal(awardsOn(awards), dayNumber(todayMs), days);
}

/**
 * The small published record of every contributor's Points that the
 * contributor and project pages read instead of the complete journal. Each
 * page shows a few values of a member: the all-time total, the points of the
 * last days and the monthly points per project. scripts/generate-points.ts
 * publishes this record at /data/points-members.json beside the full journal
 * from the same member aggregation that the leaderboard page still runs in the
 * browser (PRD section 9: public pages serve published snapshots).
 */
import type { PointAward, PointsJournal, PointsMember } from "./points";

export const POINTS_MEMBERS_FORMAT = "slop-points-members-v1";
export const MAX_POINTS_MEMBERS_BYTES = 8 * 1024 * 1024;

/** Points awarded on one UTC day. Penalty debits make a day negative. */
export interface DailyPoints {
  day: string;
  points: number;
}

/** Points awarded in one UTC month on one project. */
export interface MonthlyPoints {
  month: string;
  points: number;
}

export interface MemberPoints {
  actor: PointAward["actor"];
  /** All-time total after penalty debits, the same as the member total. */
  total: number;
  /** Every day with an award, earliest first. */
  days: DailyPoints[];
  /** Every project with an award, by id, with its months earliest first. */
  projects: { projectId: string; months: MonthlyPoints[] }[];
}

export interface PublishedPointsMembers {
  format: typeof POINTS_MEMBERS_FORMAT;
  ruleVersion: string;
  generatedAt: string;
  /** SHA-256 of the points index these members were derived with. */
  indexDigest: string;
  members: MemberPoints[];
}

const DIGEST = /^[a-f0-9]{64}$/u;
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The published record of each member, in the member order. */
export function memberPoints(members: readonly PointsMember[]): MemberPoints[] {
  return members.map((member) => {
    const days = new Map<string, number>();
    const projects = new Map<string, Map<string, number>>();
    for (const award of member.awards) {
      const day = award.occurredAt.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + award.amount);
      const months = projects.get(award.projectId) ?? new Map<string, number>();
      const month = day.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + award.amount);
      projects.set(award.projectId, months);
    }
    const ascending = (left: string, right: string) =>
      left < right ? -1 : left > right ? 1 : 0;
    return {
      actor: { id: member.actor.id, login: member.actor.login },
      total: member.total,
      days: [...days]
        .sort(([left], [right]) => ascending(left, right))
        .map(([day, points]) => ({ day, points })),
      projects: [...projects]
        .sort(([left], [right]) => ascending(left, right))
        .map(([projectId, months]) => ({
          projectId,
          months: [...months]
            .sort(([left], [right]) => ascending(left, right))
            .map(([month, points]) => ({ month, points })),
        })),
    };
  });
}

/** The record the publication derives from a journal's member aggregation. */
export function publishedPointsMembers(
  journal: Pick<PointsJournal, "ruleVersion" | "generatedAt">,
  members: readonly PointsMember[],
  indexDigest: string,
): PublishedPointsMembers {
  return {
    format: POINTS_MEMBERS_FORMAT,
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    indexDigest,
    members: memberPoints(members),
  };
}

/**
 * A member's points in one UTC month and all time, on one project or on all
 * projects: the same values as the journal aggregation filtered to that
 * project.
 */
export function pointsOf(
  member: MemberPoints,
  month: string,
  projectId?: string,
): { monthly: number; total: number } {
  const projects = projectId
    ? member.projects.filter((project) => project.projectId === projectId)
    : member.projects;
  const months = projects.flatMap((project) => project.months);
  return {
    monthly: sum(
      months.filter((entry) => entry.month === month).map((e) => e.points),
    ),
    total: projectId ? sum(months.map((entry) => entry.points)) : member.total,
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

/** Dated amounts with safe integer points, strictly ascending and unique. */
function isSeries(
  value: unknown,
  key: "day" | "month",
  pattern: RegExp,
): value is { points: number }[] {
  if (!Array.isArray(value)) return false;
  let previous = "";
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !exactKeys(entry, [key, "points"]) ||
      typeof entry[key] !== "string" ||
      !pattern.test(entry[key]) ||
      entry[key] <= previous ||
      !Number.isSafeInteger(entry.points)
    )
      return false;
    previous = entry[key];
  }
  return true;
}

function isMember(value: unknown): value is MemberPoints {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["actor", "total", "days", "projects"]) ||
    !isRecord(value.actor) ||
    !exactKeys(value.actor, ["id", "login"]) ||
    typeof value.actor.id !== "string" ||
    value.actor.id.length === 0 ||
    typeof value.actor.login !== "string" ||
    value.actor.login.length === 0 ||
    !Number.isSafeInteger(value.total) ||
    !isSeries(value.days, "day", DAY) ||
    !Array.isArray(value.projects)
  )
    return false;
  let previous = "";
  for (const project of value.projects) {
    if (
      !isRecord(project) ||
      !exactKeys(project, ["projectId", "months"]) ||
      typeof project.projectId !== "string" ||
      project.projectId <= previous ||
      !isSeries(project.months, "month", MONTH)
    )
      return false;
    previous = project.projectId;
  }
  // Every day's and every month's amount is the same award list, so the
  // total equals both series, and a project's sum equals its months.
  const months = value.projects.flatMap(
    (project) => project.months as MonthlyPoints[],
  );
  return (
    sum(value.days.map((entry) => entry.points)) === value.total &&
    sum(months.map((entry) => entry.points)) === value.total
  );
}

/** Rejects any published members that do not match this build's contract. */
export function assertPublishedPointsMembers(
  value: unknown,
): asserts value is PublishedPointsMembers {
  if (
    !isRecord(value) ||
    value.format !== POINTS_MEMBERS_FORMAT ||
    !exactKeys(value, [
      "format",
      "ruleVersion",
      "generatedAt",
      "indexDigest",
      "members",
    ]) ||
    typeof value.ruleVersion !== "string" ||
    value.ruleVersion.length === 0 ||
    !isIso(value.generatedAt) ||
    typeof value.indexDigest !== "string" ||
    !DIGEST.test(value.indexDigest) ||
    !Array.isArray(value.members) ||
    !value.members.every(isMember) ||
    new Set(value.members.map((member) => member.actor.id)).size !==
      value.members.length
  )
    throw new Error("Invalid published points members");
}

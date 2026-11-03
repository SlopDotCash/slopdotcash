import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type PointsJournal, pointMembers } from "../src/lib/points";
import {
  assertPublishedPointsMembers,
  type DailyPoints,
  memberPoints,
  pointsOf,
  publishedPointsMembers,
} from "../src/lib/points-members";
import { dailyPoints, recentPoints } from "../src/lib/profile-activity";

const journalBytes = readFileSync("data/points/history.json", "utf8");
const journal = JSON.parse(journalBytes) as PointsJournal;
const members = pointMembers(journal);
const published = memberPoints(members);

/** The daily totals the activity chart used to derive from the award list. */
function awardedDays(member: (typeof members)[number]): DailyPoints[] {
  const byDay = new Map<string, number>();
  for (const award of member.awards) {
    const day = award.occurredAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + award.amount);
  }
  return [...byDay].map(([day, points]) => ({ day, points }));
}

test("the published members reproduce the journal aggregation for every project and month", () => {
  expect(published.map((member) => member.actor)).toEqual(
    members.map((member) => ({
      id: member.actor.id,
      login: member.actor.login,
    })),
  );
  const projectIds = new Set(
    members.flatMap((member) => member.awards.map((a) => a.projectId)),
  );
  const months = new Set(
    members.flatMap((member) =>
      member.awards.map((a) => a.occurredAt.slice(0, 7)),
    ),
  );
  expect(projectIds.size).toBeGreaterThan(1);
  expect(months.size).toBeGreaterThan(1);
  // A month with no award yet, as the open month after a cutover.
  months.add("2099-01");
  let compared = 0;
  for (const projectId of [undefined, ...projectIds]) {
    for (const month of months) {
      const expected = new Map(
        pointMembers(journal, month, projectId).map((member) => [
          member.actor.id,
          member,
        ]),
      );
      for (const member of published) {
        const points = pointsOf(member, month, projectId);
        const journalMember = expected.get(member.actor.id);
        // A member without awards on this project ranks nowhere either way.
        expect([points.total, points.monthly]).toEqual([
          journalMember?.total ?? 0,
          journalMember?.monthly ?? 0,
        ]);
        if (journalMember) expect(journalMember.actor).toEqual(member.actor);
        compared += 1;
      }
      for (const [id, journalMember] of expected)
        if (journalMember.total !== 0 || journalMember.monthly !== 0)
          expect(published.some((member) => member.actor.id === id)).toBe(true);
    }
  }
  expect(compared).toBeGreaterThan(published.length * 4);
});

test("a member's daily points carry the activity chart and the recent total", () => {
  const today = new Date(journal.generatedAt);
  for (const [index, member] of members.entries()) {
    const days = awardedDays(member);
    expect(dailyPoints(published[index].days, today, 35)).toEqual(
      dailyPoints(days, today, 35),
    );
    expect(recentPoints(published[index].days, today, 30)).toBe(
      recentPoints(days, today, 30),
    );
  }
});

test("the published record is small and binds to the points index", () => {
  const record = publishedPointsMembers(journal, members, "a".repeat(64));
  const bytes = JSON.stringify(record);
  expect(() => assertPublishedPointsMembers(JSON.parse(bytes))).not.toThrow();
  expect(record.generatedAt).toBe(journal.generatedAt);
  expect(record.ruleVersion).toBe(journal.ruleVersion);
  expect(record.members).toHaveLength(members.length);
  // The journal shards the pages used to download are about fifty times larger.
  expect(bytes.length * 20).toBeLessThan(journalBytes.length);
});

test("the validator refuses a member record the pages cannot trust", () => {
  const record = publishedPointsMembers(journal, members, "a".repeat(64));
  const first = record.members.findIndex(
    (member) => member.days.length > 1 && member.projects.length > 1,
  );
  expect(first).toBeGreaterThanOrEqual(0);
  const cases: [string, (value: typeof record) => void][] = [
    ["format", (v) => (v.format = "slop-points-members-v0" as never)],
    ["digest", (v) => (v.indexDigest = "nope")],
    ["timestamp", (v) => (v.generatedAt = "yesterday")],
    ["extra key", (v) => ((v as { extra?: boolean }).extra = true)],
    ["duplicate actor", (v) => v.members.push(v.members[0])],
    ["total above its days", (v) => (v.members[first].total += 1)],
    ["day out of order", (v) => v.members[first].days.reverse()],
    ["project out of order", (v) => v.members[first].projects.reverse()],
    [
      "month amount without its day",
      (v) => {
        v.members[first].projects[0].months[0].points += 1;
      },
    ],
    [
      "fractional points",
      (v) => {
        v.members[first].days[0].points += 0.5;
        v.members[first].total += 0.5;
        v.members[first].projects[0].months[0].points += 0.5;
      },
    ],
    ["actor without login", (v) => (v.members[first].actor.login = "")],
    ["day format", (v) => (v.members[first].days[0].day = "2026-13-01")],
  ];
  for (const [label, mutate] of cases) {
    const broken = JSON.parse(JSON.stringify(record)) as typeof record;
    mutate(broken);
    expect(() => assertPublishedPointsMembers(broken), label).toThrow(
      "Invalid published points members",
    );
  }
});

import { expect, test } from "bun:test";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import {
  currentMemberActor,
  type PointsJournal,
  pointKey,
  pointMembers,
} from "../src/lib/points";

/**
 * The account menu names the signed-in member. The membership row keeps the
 * login captured at the last sign-in, while the points journal records the
 * login GitHub reported for each award; after a GitHub rename the two
 * disagree for the same permanent actor ID, and the menu must show the
 * current one (its View profile link is refused under the stale handle by
 * the profile page's rename veto).
 */
const RENAMED_ID = `U_${Buffer.from([0x92, 0x00, 0xce, 0, 0, 0x10, 0xcc]).toString("base64url")}`;
const OTHER_ID = `U_${Buffer.from([0x92, 0x00, 0xce, 0, 0, 0x10, 0xcd]).toString("base64url")}`;

const award = (id: string, login: string, day: string, workUnitId: string) => ({
  key: pointKey("eliza", id, "merged-pull-request", workUnitId),
  actor: { id, login },
  projectId: "eliza",
  category: "merged-pull-request" as const,
  amount: 30,
  occurredAt: day,
  sourceId: workUnitId,
  sourceUrl: `https://github.com/SlopDotCash/eliza/pull/${workUnitId}`,
  workUnitId,
  provisional: false,
});
const revision = (
  id: string,
  previous: string | null,
  recordedAt: string,
  awardValue: ReturnType<typeof award>,
) => ({
  id,
  previous,
  recordedAt,
  sourceDigest: "a".repeat(64),
  sourceRule: "slop-points-v1",
  award: awardValue,
});

const journal: PointsJournal = {
  schemaVersion: "1",
  ruleVersion: "slop-points-v1",
  generatedAt: "2026-11-01T12:00:00.000Z",
  coverage: [],
  revisions: [
    revision(
      "rev-1",
      null,
      "2026-10-01T00:00:00.000Z",
      award(RENAMED_ID, "old-handle", "2026-10-01T00:00:00.000Z", "101"),
    ),
    revision(
      "rev-2",
      "rev-1",
      "2026-10-30T00:00:00.000Z",
      award(RENAMED_ID, "new-handle", "2026-10-30T00:00:00.000Z", "102"),
    ),
    revision(
      "rev-3",
      null,
      "2026-10-15T00:00:00.000Z",
      award(OTHER_ID, "steady-handle", "2026-10-15T00:00:00.000Z", "103"),
    ),
  ],
};

test("the journal's current record for a renamed member carries the new login", () => {
  expect(githubUserIdFromNodeId(RENAMED_ID)).toBe("4300");
  const members = pointMembers(journal, "2026-11");
  const renamed = members.find((member) => member.actor.id === RENAMED_ID);
  expect(renamed?.actor.login).toBe("new-handle");
  expect(renamed?.total).toBe(60);
});

test("the signed-in display actor follows the journal's current login after a rename", () => {
  expect(typeof currentMemberActor).toBe("function");
  const members = pointMembers(journal, "2026-11");
  const stored = { id: RENAMED_ID, login: "old-handle" };
  expect(currentMemberActor(stored, members)).toEqual({
    id: RENAMED_ID,
    login: "new-handle",
  });
});

test("a member with no journal record keeps the stored login, and no other actor substitutes", () => {
  const members = pointMembers(journal, "2026-11");
  const absent = { id: "U_absent", login: "absent-handle" };
  expect(currentMemberActor(absent, members)).toEqual(absent);
  const steady = { id: OTHER_ID, login: "steady-handle" };
  expect(currentMemberActor(steady, members)).toEqual(steady);
  expect(currentMemberActor(steady, [])).toEqual(steady);
});

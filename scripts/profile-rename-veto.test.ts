import { expect, test } from "bun:test";
import {
  currentMemberActor,
  type PointsJournal,
  pointKey,
  pointMembers,
} from "../src/lib/points";
import {
  currentProfileActor,
  type ProfileActorDirectory,
  type ProfileActorMembership,
} from "../src/lib/profile-actor";
import type { DataState } from "../src/lib/use-snapshot";

/**
 * A renamed member's "View profile" menu link must resolve before re-login.
 * The membership row still carries the old login until the next sign-in, so
 * the signed-in actor is stale against the journal's current record; that
 * staleness must not veto the profile for the new handle, while the
 * login-collision veto (same login, different id) and the stale-handle
 * refusal stay in force.
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

const members = pointMembers(journal, "2026-11");
const storedOld = { id: RENAMED_ID, login: "old-handle" };
const storedNew = { id: RENAMED_ID, login: "new-handle" };

const state = (leaders: { actor: { id: string; login: string } }[]) =>
  ({
    status: "ready",
    snapshot: { leaders },
    views: [],
  }) as unknown as DataState;
const readyState = state(members.map((member) => ({ actor: member.actor })));
const profiles = (people: { id: string; login: string }[]) =>
  ({
    status: "ready",
    index: { people },
  }) as ProfileActorDirectory;
const currentDirectory = profiles([
  { id: RENAMED_ID, login: "new-handle" },
  { id: OTHER_ID, login: "steady-handle" },
]);
const staleDirectory = profiles([
  { id: RENAMED_ID, login: "old-handle" },
  { id: OTHER_ID, login: "steady-handle" },
]);

// Before re-login /me returns the stored old login (backend/points/handler.ts
// returns the membership row as-is) and /member?login=new-handle returns null
// (lookup is by the membership login), so own and joined are both null for
// the new handle while the signed-in actor stays the stale old handle.
const membershipBefore = (urlLogin: string) =>
  ({
    own:
      storedOld.login.toLowerCase() === urlLogin.toLowerCase()
        ? { actor: storedOld, joinedAt: "2026-10-01", public: true }
        : null,
    signedInActor: storedOld,
    sessionStatus: "ready",
    joined: null,
    joinStatus: "ready",
  }) as ProfileActorMembership;
// After re-login the membership row carries the new login.
const membershipAfter = {
  own: { actor: storedNew, joinedAt: "2026-10-01", public: true },
  signedInActor: storedNew,
  sessionStatus: "ready",
  joined: { actor: storedNew, joinedAt: "2026-10-01", public: true },
  joinStatus: "ready",
} as ProfileActorMembership;

test("the renamed member's new-handle profile resolves before re-login", () => {
  expect(currentMemberActor(storedOld, members)).toEqual(storedNew);
  const actor = currentProfileActor(
    readyState,
    "new-handle",
    currentDirectory,
    membershipBefore("new-handle"),
  );
  expect(actor?.login).toBe("new-handle");
  expect(actor?.id).toBe(RENAMED_ID);
});

test("the stale old handle stays refused before re-login", () => {
  expect(
    currentProfileActor(
      readyState,
      "old-handle",
      currentDirectory,
      membershipBefore("old-handle"),
    ),
  ).toBeUndefined();
});

test("the profile resolves after re-login", () => {
  const actor = currentProfileActor(
    readyState,
    "new-handle",
    currentDirectory,
    membershipAfter,
  );
  expect(actor?.login).toBe("new-handle");
});

test("a login collision still refuses when two ids claim one login", () => {
  const collisionState = state([
    { actor: { id: OTHER_ID, login: "dup-handle" } },
  ]);
  const claimed = { id: RENAMED_ID, login: "dup-handle" };
  const membership = {
    own: { actor: claimed, joinedAt: "2026-10-01", public: true },
    signedInActor: claimed,
    sessionStatus: "ready",
    joined: null,
    joinStatus: "ready",
  } as ProfileActorMembership;
  expect(
    currentProfileActor(collisionState, "dup-handle", profiles([]), membership),
  ).toBeUndefined();
});

test("a stale signed-in login does not lift the collision veto on the new handle", () => {
  const collisionState = state([
    { actor: storedNew },
    { actor: { id: OTHER_ID, login: "new-handle" } },
  ]);
  expect(
    currentProfileActor(
      collisionState,
      "new-handle",
      currentDirectory,
      membershipBefore("new-handle"),
    ),
  ).toBeUndefined();
});

test("a directory that still lists the old login still vetoes the new handle", () => {
  expect(
    currentProfileActor(
      readyState,
      "new-handle",
      staleDirectory,
      membershipBefore("new-handle"),
    ),
  ).toBeUndefined();
});

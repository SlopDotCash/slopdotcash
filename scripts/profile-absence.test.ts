/**
 * A contributor profile may say the login is unknown only after every source
 * has a current answer. A copy kept after a failed refresh can omit someone
 * the failed read would have named, so that copy is not an empty result.
 */
import { expect, test } from "bun:test";
import { profileRead, unresolvedProfile } from "../src/lib/profile-actor";

const settled = {
  directory: profileRead("current"),
  journal: profileRead("current"),
  snapshot: profileRead("current"),
  membership: "settled" as const,
  session: "ready" as const,
};

test("a login missing from every current source is unknown", () => {
  expect(unresolvedProfile(settled)).toBe("unknown");
});

test("a directory kept after a failed refresh is not an empty profile", () => {
  expect(
    unresolvedProfile({
      ...settled,
      directory: profileRead("current", true),
    }),
  ).toBe("unavailable");
});

test("a Points journal kept after a failed reload is not an empty profile", () => {
  expect(
    unresolvedProfile({
      ...settled,
      journal: profileRead("current", true),
    }),
  ).toBe("unavailable");
});

test("a leaderboard snapshot kept after a failed refresh is not an empty profile", () => {
  expect(
    unresolvedProfile({
      ...settled,
      snapshot: profileRead("current", true),
    }),
  ).toBe("unavailable");
});

test("a failed directory read stays unavailable, and a still-loading journal waits", () => {
  expect(
    unresolvedProfile({
      ...settled,
      directory: profileRead("failed"),
    }),
  ).toBe("unavailable");
  expect(
    unresolvedProfile({
      ...settled,
      directory: profileRead("failed"),
      journal: profileRead("loading"),
    }),
  ).toBe("pending");
});

test("membership and session failures stay unavailable instead of unknown", () => {
  expect(unresolvedProfile({ ...settled, membership: "unavailable" })).toBe(
    "unavailable",
  );
  expect(unresolvedProfile({ ...settled, session: "error" })).toBe(
    "unavailable",
  );
  expect(unresolvedProfile({ ...settled, membership: "loading" })).toBe(
    "pending",
  );
});

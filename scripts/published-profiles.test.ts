import { expect, test } from "bun:test";
import type { ProfileIndex } from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { assertPublishedProfiles } from "./published-profiles";

const targets = TARGET_REPOSITORIES.map((repository) => repository.id);

/** A census that collected exactly `repositories`, with no people or issues. */
function census(repositories: readonly string[]): ProfileIndex {
  return {
    schemaVersion: "2",
    startedAt: "2026-10-30T06:22:40.043Z",
    generatedAt: "2026-10-30T06:28:19.077Z",
    repositories: repositories.map((repository) => ({
      repository,
      count: 0,
      excluded: 0,
    })),
    people: [],
    issues: {
      firstObservedAt: "2026-10-01T00:00:00.000Z",
      repositories: repositories.map((repository) => ({
        repository,
        count: 0,
      })),
      items: [],
    },
  } as ProfileIndex;
}

test("the fixture registry has a current target to drop", () => {
  expect(targets.length).toBeGreaterThan(1);
});

test("a published census of every current target passes both checks", () => {
  expect(() =>
    assertPublishedProfiles(census(targets), { current: false }),
  ).not.toThrow();
  expect(() =>
    assertPublishedProfiles(census(targets), { current: true }),
  ).not.toThrow();
});

// The browser checks the census against the current targets, and a mismatch
// makes every contributor profile unavailable. A census taken before a project
// was activated stays valid against its own inventory, so a release that
// ships it with current code must also apply the current check.
for (const dropped of [0, targets.length - 1]) {
  test(`a published census missing ${targets[dropped]} fails only the current check`, () => {
    const stale = census(targets.filter((_, index) => index !== dropped));
    expect(() =>
      assertPublishedProfiles(stale, { current: false }),
    ).not.toThrow();
    expect(() => assertPublishedProfiles(stale, { current: true })).toThrow(
      "Profile repository inventory mismatch",
    );
  });
}

import { expect, test } from "bun:test";
import {
  assertProfiles,
  type ProfileIndex,
  type ProfileIssue,
} from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { extendPublishedProfiles } from "./extend-published-profiles";
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

function history(index: ProfileIndex) {
  if (!index.issues) throw Error("Expected issue history");
  return index.issues;
}

function issue(id: string, repository: string): ProfileIssue {
  return {
    id,
    repository,
    number: 1,
    authorId: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    observedAt: "2026-10-29T00:00:00.000Z",
    state: "CLOSED",
    reason: "COMPLETED",
    unavailableSince: null,
    correctedAt: "2026-10-28T00:00:00.000Z",
    events: [
      {
        id: `${id}-closed`,
        kind: "closed",
        occurredAt: "2026-10-03T00:00:00.000Z",
        reason: "COMPLETED",
        relatedIssueId: null,
      },
    ],
  };
}

test("retiring a repository archives every exact issue object without changing PR history or dates", () => {
  const [active, retired, previouslyArchived] = targets;
  const old = census([active, retired]);
  old.repositories[1] = { repository: retired, count: 7, excluded: 2 };
  old.people = [
    {
      id: "user-1234",
      login: "reporter",
      avatarUrl: "https://avatars.githubusercontent.com/u/1234",
      repositories: [{ repository: retired, merged: 3, open: 1, closed: 1 }],
    },
  ];
  const visible = issue("visible", active);
  const historical = issue("historical", retired);
  const unavailable = {
    ...issue("unavailable", retired),
    unavailableSince: old.generatedAt,
  };
  const archived = issue("already-archived", previouslyArchived);
  history(old).items = [visible, historical, unavailable];
  history(old).archived = [archived];
  history(old).repositories.forEach((row) => {
    row.count = 1;
  });
  const original = structuredClone(old);
  expect(() => assertProfiles(old, [active])).toThrow(
    "Issue repository inventory mismatch",
  );
  const result = extendPublishedProfiles(old, [active]);
  expect(result.added).toEqual([]);
  expect(history(result.census).repositories).toEqual([
    { repository: active, count: 1 },
  ]);
  expect(history(result.census).items).toEqual([visible]);
  expect(history(result.census).items[0]).toBe(visible);
  expect(history(result.census).archived).toEqual([
    historical,
    unavailable,
    archived,
  ]);
  for (const [index, record] of [historical, unavailable, archived].entries())
    expect(history(result.census).archived?.[index]).toBe(record);
  expect(result.census.people).toBe(old.people);
  expect(result.census.repositories).toEqual(old.repositories);
  for (const [index, row] of old.repositories.entries())
    expect(result.census.repositories[index]).toBe(row);
  expect(result.census.startedAt).toBe(old.startedAt);
  expect(result.census.generatedAt).toBe(old.generatedAt);
  expect(history(result.census).firstObservedAt).toBe(
    history(old).firstObservedAt,
  );
  expect(old).toEqual(original);
  expect(() => assertProfiles(result.census, [active])).not.toThrow();
  expect(extendPublishedProfiles(result.census, [active]).census).toEqual(
    result.census,
  );
});

test("reactivation restores retained issue counts and only genuinely new issue coverage is zero", () => {
  const [active, reactivated, newlyActive] = targets;
  const old = census([active]);
  const retained = issue("retained", reactivated);
  const unavailable = {
    ...issue("retained-unavailable", reactivated),
    unavailableSince: old.generatedAt,
  };
  history(old).archived = [retained, unavailable];
  const result = extendPublishedProfiles(old, [
    active,
    reactivated,
    newlyActive,
  ]);
  expect(result.added).toEqual([reactivated, newlyActive]);
  expect(result.census.repositories.slice(1)).toEqual([
    { repository: reactivated, count: 0, excluded: 0 },
    { repository: newlyActive, count: 0, excluded: 0 },
  ]);
  expect(history(result.census).repositories).toEqual([
    { repository: active, count: 0 },
    { repository: reactivated, count: 1 },
    { repository: newlyActive, count: 0 },
  ]);
  expect(history(result.census).items[0]).toBe(retained);
  expect(history(result.census).items[1]).toBe(unavailable);
  expect(history(result.census).archived).toEqual([]);
  expect(result.census.generatedAt).toBe(old.generatedAt);
  expect(() =>
    assertProfiles(result.census, [active, reactivated, newlyActive]),
  ).not.toThrow();
});

test("projection refuses corrupt retained counts or duplicate history instead of hiding them in the archive", () => {
  const [active, retired] = targets;
  const corrupt = census([active, retired]);
  history(corrupt).repositories[1].count = 1;
  expect(() => extendPublishedProfiles(corrupt, [active])).toThrow(
    "Incomplete issue census",
  );
  const duplicate = census([active, retired]);
  history(duplicate).items = [
    issue("same-id", retired),
    issue("same-id", retired),
  ];
  history(duplicate).repositories[1].count = 2;
  expect(() => extendPublishedProfiles(duplicate, [active])).toThrow(
    "Invalid issue history record",
  );
});

test("an empty active inventory archives all retained issues without dropping historical counts", () => {
  const old = census([targets[0]]);
  const retained = issue("all-inactive", targets[0]);
  history(old).items = [retained];
  history(old).repositories[0].count = 1;
  const result = extendPublishedProfiles(old, []).census;
  expect(result.repositories).toEqual(old.repositories);
  expect(history(result).repositories).toEqual([]);
  expect(history(result).items).toEqual([]);
  expect(history(result).archived).toEqual([retained]);
  expect(history(result).archived?.[0]).toBe(retained);
  expect(() => assertProfiles(result, [])).not.toThrow();
});

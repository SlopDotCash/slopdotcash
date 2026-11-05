import { expect, test } from "bun:test";
import {
  journalLoginsByActorId,
  POINTS_RULE,
  type PointAward,
  type PointRevision,
  type PointsJournal,
  pointRevisionId,
} from "../src/lib/points";
import { directoryLoginMatches } from "../src/lib/profiles";

/**
 * The People directory carries one login per person — the current one from
 * the profile census — while the points journal keeps the login each award
 * was recorded under. A contributor who renames their GitHub account is
 * therefore named one way in the directory and another way in the journal
 * (and in the standings the journal feeds). Searching the directory by the
 * recorded login must still find the person: identity follows the permanent
 * actor ID through renames (PRD section 3).
 */

const RENAMED_ID = "MDQ6VXNlcjg2NTUzNTgw";

function award(id: string, login: string, key: string): PointAward {
  return {
    key,
    actor: { id, login },
    projectId: "slopdotcash",
    category: "merged-pull-request",
    amount: 10,
    occurredAt: "2026-09-15T00:00:00.000Z",
    sourceId: `source:${key}`,
    sourceUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
    workUnitId: `wu:${key}`,
    provisional: false,
  };
}

function revision(aw: PointAward, recordedAt: string): PointRevision {
  const body = {
    previous: null,
    recordedAt,
    sourceDigest: "a".repeat(64),
    sourceRule: "slop-score-v2",
    award: aw,
  };
  return { id: pointRevisionId(body), ...body };
}

function journal(revisions: PointRevision[]): PointsJournal {
  return {
    schemaVersion: "1" as const,
    ruleVersion: POINTS_RULE,
    generatedAt: "2026-10-01T00:00:00.000Z",
    coverage: [],
    revisions,
  };
}

/** The renamed contributor's journal: every revision predates the rename. */
function renamedJournal() {
  return journal([
    revision(
      award(RENAMED_ID, "former-handle", "key:1"),
      "2026-08-01T00:00:00.000Z",
    ),
    revision(
      award(RENAMED_ID, "former-handle", "key:2"),
      "2026-09-01T00:00:00.000Z",
    ),
    revision(award("A2", "stable-handle", "key:3"), "2026-09-02T00:00:00.000Z"),
  ]);
}

test("journalLoginsByActorId collects every recorded login per actor ID", () => {
  const logins = journalLoginsByActorId(renamedJournal());
  expect([...(logins.get(RENAMED_ID) ?? [])]).toEqual(["former-handle"]);
  expect([...(logins.get("A2") ?? [])]).toEqual(["stable-handle"]);
  expect(logins.get("nobody")).toBeUndefined();
});

test("journalLoginsByActorId keeps both spellings across a recorded rename", () => {
  const logins = journalLoginsByActorId(
    journal([
      revision(
        award(RENAMED_ID, "former-handle", "key:1"),
        "2026-08-01T00:00:00.000Z",
      ),
      revision(
        award(RENAMED_ID, "current-handle", "key:2"),
        "2026-10-01T00:00:00.000Z",
      ),
    ]),
  );
  expect(new Set(logins.get(RENAMED_ID))).toEqual(
    new Set(["former-handle", "current-handle"]),
  );
  expect(journalLoginsByActorId(journal([])).size).toBe(0);
});

test("directory search finds a renamed contributor by the recorded login", () => {
  // The directory row carries the current (census) login only.
  const row = { id: RENAMED_ID, login: "current-handle" };
  const recorded = journalLoginsByActorId(renamedJournal());
  const loginsFor = (p: { id: string; login: string }) => [
    p.login,
    ...(recorded.get(p.id) ?? []),
  ];
  // The handle the journal and the standings name the person by.
  expect(directoryLoginMatches(loginsFor(row), "former-handle")).toBe(true);
  expect(directoryLoginMatches(loginsFor(row), "FORMER-Handle")).toBe(true);
  expect(directoryLoginMatches(loginsFor(row), "former")).toBe(true);
  // The current login keeps matching, and unrelated queries keep missing.
  expect(directoryLoginMatches(loginsFor(row), "current-handle")).toBe(true);
  expect(directoryLoginMatches(loginsFor(row), "someone-else")).toBe(false);
  expect(directoryLoginMatches(loginsFor(row), "  ")).toBe(true);
});

test("a re-registered handle matches its new owner and its former owner", () => {
  const recorded = journalLoginsByActorId(renamedJournal());
  const renamed = { id: RENAMED_ID, login: "current-handle" };
  const newOwner = { id: "A9", login: "former-handle" };
  const loginsFor = (p: { id: string; login: string }) => [
    p.login,
    ...(recorded.get(p.id) ?? []),
  ];
  // Search recall: both people are answers to the shared handle; the rows
  // still display under their own current logins.
  expect(directoryLoginMatches(loginsFor(newOwner), "former-handle")).toBe(
    true,
  );
  expect(directoryLoginMatches(loginsFor(renamed), "former-handle")).toBe(true);
});

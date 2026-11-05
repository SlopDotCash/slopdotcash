import { expect, test } from "bun:test";
import { compareActors } from "../src/lib/github-actor";
import {
  POINTS_RULE,
  type PointAward,
  type PointRevision,
  type PointsJournal,
  pointMembers,
  pointRevisionId,
} from "../src/lib/points";
import { pointsSummary } from "./generate-points";

/**
 * Points standings are standings: tied contributors take the canonical
 * login-and-ID tie order (compareActors) that project standings and the
 * global leaderboard already use, on every host. Ordering ties by the raw
 * node ID under the host's default locale instead puts the same two
 * contributors in opposite orders on different standings surfaces, and the
 * order itself changes with the host locale (a default locale that
 * case-folds "I" to "ı" flips node-ID comparisons).
 */

function award(
  actor: { id: string; login: string },
  amount: number,
  workUnitId: string,
): PointAward {
  return {
    key: `key:${workUnitId}`,
    actor,
    projectId: "slopdotcash",
    category: "merged-pull-request",
    amount,
    occurredAt: "2026-10-15T00:00:00.000Z",
    sourceId: `source:${workUnitId}`,
    sourceUrl: `https://github.com/SlopDotCash/slopdotcash/pull/1`,
    workUnitId,
    provisional: false,
  };
}

function revision(aw: PointAward): PointRevision {
  const body = {
    previous: null,
    recordedAt: "2026-10-16T00:00:00.000Z",
    sourceDigest: "a".repeat(64),
    sourceRule: "slop-score-v2",
    award: aw,
  };
  return { id: pointRevisionId(body), ...body };
}

function journal(awards: PointAward[]): PointsJournal {
  return {
    schemaVersion: "1" as const,
    ruleVersion: POINTS_RULE,
    generatedAt: "2026-11-01T00:00:00.000Z",
    coverage: [],
    revisions: awards.map(revision),
  };
}

// Three contributors tied at 100 points whose node-ID order
// (AAAA < MMMM < ZZZZ) is the reverse of their login order, plus one
// higher scorer whose login and ID both sort last.
const TIED = [
  { id: "U_kgDOAAAAAA", login: "zack" },
  { id: "U_kgDOMMMMMM", login: "Marta" },
  { id: "U_kgDOZZZZZZ", login: "aaron" },
];
const TOP = { id: "U_kgDOZZZZZY", login: "zzzz" };

function tiedJournal(): PointsJournal {
  return journal([
    ...TIED.map((actor, i) => award(actor, 100, `wu:tie:${i}`)),
    award(TOP, 200, "wu:top"),
  ]);
}

test("point members order tied contributors by the canonical actor order", () => {
  const members = pointMembers(tiedJournal());
  const canonical = [...TIED].sort(compareActors).map((a) => a.login);
  expect(canonical).toEqual(["aaron", "Marta", "zack"]);
  expect(members.map((m) => m.actor.login)).toEqual(["zzzz", ...canonical]);
  expect(members.map((m) => m.total)).toEqual([200, 100, 100, 100]);
});

test("the published points summary keeps the same tied order", () => {
  const j = tiedJournal();
  const summary = pointsSummary(j, pointMembers(j), "a".repeat(64));
  expect(summary.contributors.map((c) => c.actor.login)).toEqual([
    "zzzz",
    "aaron",
    "Marta",
    "zack",
  ]);
  expect(summary.totals).toEqual({ contributors: 4, points: 500 });
});

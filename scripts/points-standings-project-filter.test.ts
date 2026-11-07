import { expect, test } from "bun:test";
import {
  POINTS_RULE,
  type PointAward,
  type PointRevision,
  type PointsJournal,
  pointMembers,
  pointRevisionId,
  standingsProjectId,
} from "../src/lib/points";
import { findProject } from "../src/lib/projects.mjs";

/**
 * The Leaderboard's shareable ?project= filter selects one project's
 * earned-point standings (PRD section 7: "shareable filters"). A project
 * that has since been retired or removed leaves the listed registry, so
 * resolving the filter through the listed registry alone drops it: the
 * page then shows the all-project ranking instead of the recorded
 * standings the Points journal still holds for that project (AGENTS.md:
 * a retired project is hidden "while its history still resolves";
 * protocol/points-v1.md: "Recorded totals persist"). The filter must
 * resolve a history-bearing project id to that project's standings.
 */

const MONTH = "2026-09";
const ALICE = { id: "A1", login: "alice" };
const BOB = { id: "A2", login: "bob" };

let seq = 0;
function award(
  actor: typeof ALICE,
  projectId: string,
  amount: number,
): PointAward {
  seq += 1;
  return {
    key: `key-${seq}`,
    actor,
    projectId,
    category: "merged-pull-request",
    amount,
    occurredAt: "2026-09-15T00:00:00.000Z",
    sourceId: `src-${seq}`,
    sourceUrl: `https://github.com/elizaOS/eliza/pull/${100 + seq}`,
    workUnitId: `wu-${seq}`,
    provisional: false,
  };
}

function revision(aw: PointAward): PointRevision {
  const body = {
    previous: null,
    recordedAt: "2026-09-16T00:00:00.000Z",
    sourceDigest: "a".repeat(64),
    sourceRule: "slop-score-v2",
    award: aw,
  };
  return { id: pointRevisionId(body), ...body };
}

function fixtureJournal(): PointsJournal {
  return {
    schemaVersion: "1",
    ruleVersion: POINTS_RULE,
    generatedAt: "2026-10-01T00:00:00.000Z",
    coverage: [],
    revisions: [
      // "heir-elements-sdk" is retired in the fixture registry
      // (listingTier "retired"); its journal awards remain recorded.
      revision(award(ALICE, "heir-elements-sdk", 60)),
      revision(award(BOB, "heir-elements-sdk", 45)),
      revision(award(ALICE, "asi", 90)),
      revision(award(ALICE, "eliza", 300)),
    ],
  };
}

test("the retired fixture project is absent from the listed registry", () => {
  expect(findProject("heir-elements-sdk")).toBeNull();
});

test("a retired project's filter resolves to its recorded standings", () => {
  const resolved = standingsProjectId("heir-elements-sdk");
  expect(resolved).toBe("heir-elements-sdk");
  const members = pointMembers(fixtureJournal(), MONTH, resolved || undefined);
  expect(members.map((m) => [m.actor.login, m.total])).toEqual([
    ["alice", 60],
    ["bob", 45],
  ]);
});

test("a listed project still resolves, by id or slug, case-insensitively", () => {
  expect(standingsProjectId("asi")).toBe("asi");
  expect(standingsProjectId(" ASI ")).toBe("asi");
  const members = pointMembers(
    fixtureJournal(),
    MONTH,
    standingsProjectId("asi") || undefined,
  );
  expect(members.map((m) => [m.actor.login, m.total])).toEqual([["alice", 90]]);
});

test("a value with no recorded project history selects no project filter", () => {
  expect(standingsProjectId("no-such-project")).toBe("");
  expect(standingsProjectId("")).toBe("");
  expect(standingsProjectId(null)).toBe("");
});

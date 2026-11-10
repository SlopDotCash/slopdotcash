// GitHub emits two node-ID spellings for the same user: the legacy `MDQ6…`
// form (base64 of `04:User<id>`) and the current `U_…` form (base64url
// MessagePack). Points, penalties, and the leaderboard must group both
// spellings under the numeric GitHub ID (canonicalActorKey), or one person
// splits into two members, the same work unit counts twice, and a Slopbot
// debit under one spelling misses credits under the other.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canonicalActorKey,
  githubUserIdFromNodeId,
} from "../src/lib/github-actor";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { GitHubActor } from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  applyPointsSnapshot,
  emptyPointsJournal,
  type PointAward,
  type PointsJournal,
  pointKey,
  pointMembers,
  reconcilePointPenalties,
} from "../src/lib/points";
import { penaltyDeductions } from "../src/lib/score-penalties";
import {
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

/** Numeric GitHub user 18633264 under both node-ID spellings. */
const LEGACY = "MDQ6VXNlcjE4NjMzMjY0";
const CURRENT = "U_kgDOARxSMA";
/** Numeric GitHub user 42 under the current spelling. */
const CURRENT_42 = "U_kgDOAAAAKg";
const AT = "2026-11-20T00:00:00.000Z";
const LOGIN = "spelling-split";

function actor(id: string): GitHubActor {
  return {
    id,
    login: LOGIN,
    avatarUrl: "https://avatars.githubusercontent.com/u/18633264?v=4",
    url: `https://github.com/${LOGIN}`,
    kind: "User",
  };
}

function award(
  sourceId: string,
  amount: number,
  actorId: string,
  number: number,
  category: PointAward["category"] = "merged-pull-request",
  sourceUrl?: string,
): PointAward {
  return {
    key: pointKey("asi", actorId, category, sourceId),
    actor: { id: actorId, login: LOGIN },
    projectId: "asi",
    category,
    amount,
    occurredAt: AT,
    sourceId,
    sourceUrl: sourceUrl ?? `https://github.com/SlopDotCash/asi/pull/${number}`,
    workUnitId: sourceId,
    provisional: false,
  };
}

function journalWith(awards: PointAward[]): PointsJournal {
  return appendPointAwards(
    emptyPointsJournal(AT),
    awards,
    "a".repeat(64),
    "slop-score-v2",
    AT,
  );
}

function checkpoint(): PointsJournal {
  return JSON.parse(readFileSync("data/points/history.json", "utf8"));
}

test("canonicalActorKey maps both node spellings to the numeric id", () => {
  expect(githubUserIdFromNodeId(LEGACY)).toBe("18633264");
  expect(githubUserIdFromNodeId(CURRENT)).toBe("18633264");
  expect(githubUserIdFromNodeId(CURRENT_42)).toBe("42");
  expect(canonicalActorKey(LEGACY)).toBe("18633264");
  expect(canonicalActorKey(CURRENT)).toBe("18633264");
  expect(canonicalActorKey(CURRENT_42)).toBe("42");
  expect(canonicalActorKey("MDQ6VXNlcjQy")).toBe("42");
  // Undecodable ids are left alone, never collapsed.
  expect(canonicalActorKey("not-a-node-id")).toBe("not-a-node-id");
});

test("one person, two spellings: pointMembers returns one member", () => {
  const members = pointMembers(
    journalWith([
      award("PR_legacy", 30, LEGACY, 100),
      award("PR_current", 40, CURRENT, 101),
    ]),
  );
  expect(members.length).toBe(1);
  expect(members[0].total).toBe(70);
});

test("two different people stay two members", () => {
  const members = pointMembers(
    journalWith([
      award("PR_a", 30, "MDQ6VXNlcjQy", 100),
      award("PR_b", 40, "MDQ6VXNlcjQz", 101),
    ]),
  );
  expect(members.length).toBe(2);
  expect(members.map((m) => m.total).sort()).toEqual([30, 40]);
});

test("same work unit under both spellings counts once", () => {
  const members = pointMembers(
    journalWith([
      award("PR_same", 30, LEGACY, 100),
      award("PR_same", 30, CURRENT, 100),
    ]),
  );
  expect(members.length).toBe(1);
  expect(members[0].total).toBe(30);
});

test("evaluated-review suppression applies across spellings", () => {
  // Same reviewer, same PR review URL; the evaluated award carries the
  // legacy spelling and the substantive review the current spelling.
  const reviewUrl =
    "https://github.com/SlopDotCash/asi/pull/100#pullrequestreview-123";
  const members = pointMembers(
    journalWith([
      award("EVAL_1", 30, LEGACY, 100, "evaluated-contribution", reviewUrl),
      award("PR_100", 20, CURRENT, 100, "substantive-review", reviewUrl),
    ]),
  );
  // The substantive review must be suppressed by the evaluated award:
  // one member, total 30 (the evaluated award only).
  expect(members.length).toBe(1);
  expect(members[0].total).toBe(30);
});

test("penaltyDeductions applies a debit across spellings", () => {
  const repository = "https://github.com/SlopDotCash/asi";
  const deductions = penaltyDeductions(
    [
      {
        actor: actor(LEGACY),
        repository,
        occurredAt: AT,
        scoreThirds: 90,
        points: 30,
      },
    ],
    [
      {
        id: "PEN_1",
        actor: actor(CURRENT),
        repository,
        occurredAt: AT,
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 90,
        source: {
          id: "PR_spam",
          kind: "pull-request",
          number: 5,
          title: "Spam",
          url: "https://github.com/SlopDotCash/asi/pull/5",
        },
      },
    ],
    () => "asi",
  );
  expect(deductions.byActor.get("18633264")).toBe(90);
  expect(deductions.byPenalty.get("PEN_1")).toBe(90);
});

test("a Slopbot debit under the current spelling applies to credits under the legacy spelling", () => {
  setSystemTime(new Date(GENERATED_AT));
  const feed = [
    {
      itemNodeId: "PR_spelling",
      authorGithubId: "42",
      category: "spam",
      tableVersion: "slopbot-penalties-v1",
      debitThirds: 3,
      period: "2026-11",
      recordedAt: "2026-11-10T00:00:00.000Z",
    },
  ];
  const input = penaltyScoreInput(feed);
  const closed = input.closedUnmergedPullRequests?.[0];
  if (!closed) throw new Error("Missing closed-source fixture");
  // The same person (user 42) is recorded under the current spelling in
  // the closed pull request, while the accepted work carries the legacy
  // spelling from the merged pull requests.
  input.closedUnmergedPullRequests = [
    {
      ...closed,
      id: "PR_spelling",
      number: 20000,
      url: "https://github.com/SlopDotCash/asi/pull/20000",
      author: {
        id: CURRENT_42,
        login: "author",
        avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
        url: "https://github.com/author",
        kind: "User",
      },
    },
  ];
  const snapshot = createLeaderboardSnapshot(input);
  const work = applyPointsSnapshot(
    checkpoint(),
    createLeaderboardSnapshot({ ...input, penalties: [] }),
    "b".repeat(64),
    GENERATED_AT,
  );
  const before = pointMembers(work).find(
    (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
  );
  if (!before) throw new Error("Missing accepted-work fixture");
  const corrected = reconcilePointPenalties(
    work,
    "a".repeat(64),
    GENERATED_AT,
    snapshot,
  );
  const appended = corrected.revisions.slice(work.revisions.length);
  const applied = appended.reduce(
    (sum, revision) => sum + revision.award.amount,
    0,
  );
  expect(appended.length).toBeGreaterThan(0);
  expect(applied).toBeLessThan(0);
  const after = pointMembers(corrected).find(
    (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
  );
  if (!after) throw new Error("Missing reconciled member");
  expect(after.total).toBe(before.total + applied);
});

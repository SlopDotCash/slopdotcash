import { expect, test } from "bun:test";
import type { CycleIndex, CycleIndexEntry } from "./cycle-index";
import { createGlobalLeaders, openMonthScores } from "./global-leaderboard";
import type {
  GitHubActor,
  LeaderboardSnapshot,
  ScoreEvent,
} from "./leaderboard";

const alice: GitHubActor = {
  id: "1001",
  login: "alice",
  avatarUrl: "https://avatars.githubusercontent.com/alice?size=96",
  url: "https://github.com/alice",
  kind: "User",
};
const bob: GitHubActor = {
  id: "1002",
  login: "bob",
  avatarUrl: "https://avatars.githubusercontent.com/bob?size=96",
  url: "https://github.com/bob",
  kind: "User",
};

function mergedEvent(
  actor: GitHubActor,
  repository: string,
  occurredAt: string,
  scoreThirds: number,
): ScoreEvent {
  return {
    id: `event:${actor.login}:${occurredAt}`,
    actor,
    category: "merged-pull-request",
    points: scoreThirds / 3,
    scoreThirds,
    occurredAt,
    repository,
    source: {
      id: "PR_1",
      kind: "pull-request",
      number: 1,
      title: "fix",
      url: `https://github.com/${repository}/pull/1`,
    },
    reason: "merged",
  } as unknown as ScoreEvent;
}

function contributor(
  actor: GitHubActor,
  scoreThirds: number,
  state = "proposed",
) {
  return {
    actor: { id: actor.id, login: actor.login },
    score: Math.floor(scoreThirds / 3),
    scoreThirds,
    state,
    suggestedMinor: "0",
    approvedMinor: "0",
    paidMinor: "0",
    sharePartsPerMillion: null,
    wallet: null,
  };
}

function cycleEntry(
  projectId: string,
  cycleId: string,
  state: CycleIndexEntry["state"],
  contributors: ReturnType<typeof contributor>[],
): CycleIndexEntry {
  return {
    projectId,
    cycleId,
    kind: projectId === "delta-star" ? "external-prize-share" : "monthly-pool",
    state,
    generatedAt: "2026-10-01T00:00:00.000Z",
    contributionWindow: {
      from: `${cycleId}-01T00:00:00.000Z`,
      to: `${cycleId}-30T23:59:59.999Z`,
    },
    reviewEndsAt: null,
    approvedAt: null,
    settledAt: null,
    reward: {
      currency: "USDC",
      capMinor: "0",
      suggestedMinor: "0",
      approvedMinor: "0",
      paidMinor: "0",
      feeMinor: "0",
      sharePartsPerMillion: null,
    },
    contributors,
    files: {
      sourceSnapshot: {
        sha256: "0".repeat(64),
        url: "https://example.invalid/source-snapshot.json",
      },
      proposal: {
        sha256: "0".repeat(64),
        url: "https://example.invalid/proposal.json",
      },
      allocation: null,
      executionPlan: null,
      settlement: null,
      windup: null,
    },
  } as unknown as CycleIndexEntry;
}

function snapshot(ledger: ScoreEvent[]): LeaderboardSnapshot {
  return {
    leaders: [],
    ledger,
    penalties: [],
  } as unknown as LeaderboardSnapshot;
}

function index(cycles: CycleIndexEntry[]): CycleIndex {
  return {
    schemaVersion: "1",
    generatedAt: "2026-10-01T00:00:00.000Z",
    cycles,
  } as unknown as CycleIndex;
}

test("counts a ledger event for an actor a closed-no-awards cycle omits", () => {
  const leaders = createGlobalLeaders(
    snapshot([
      mergedEvent(alice, "elizaOS/eliza", "2026-09-10T00:00:00.000Z", 9),
    ]),
    [],
    index([cycleEntry("eliza", "2026-09", "closed-no-awards", [])]),
  );
  expect(leaders).toEqual([
    {
      actor: alice,
      score: 3,
      tokens: 0,
      projectedMinor: 0n,
      paidMinor: 0n,
      projects: 1,
      cycles: 1,
    },
  ]);
});

test("counts a ledger event for an actor missing from a review-state cycle", () => {
  const leaders = createGlobalLeaders(
    snapshot([
      mergedEvent(alice, "elizaOS/eliza", "2026-09-10T00:00:00.000Z", 9),
      mergedEvent(bob, "elizaOS/eliza", "2026-09-11T00:00:00.000Z", 9),
    ]),
    [],
    index([cycleEntry("eliza", "2026-09", "review", [contributor(bob, 3)])]),
  );
  expect(leaders.map((leader) => [leader.actor.login, leader.score])).toEqual([
    ["alice", 3],
    ["bob", 1],
  ]);
});

test("counts a listed actor once when the cycle and the ledger agree", () => {
  const leaders = createGlobalLeaders(
    snapshot([
      mergedEvent(alice, "elizaOS/eliza", "2026-09-10T00:00:00.000Z", 9),
    ]),
    [],
    index([cycleEntry("eliza", "2026-09", "review", [contributor(alice, 9)])]),
  );
  expect(leaders).toEqual([
    {
      actor: alice,
      score: 3,
      tokens: 0,
      projectedMinor: 0n,
      paidMinor: 0n,
      projects: 1,
      cycles: 1,
    },
  ]);
});

test("counts a ledger event for an empty external-share cycle month", () => {
  const leaders = createGlobalLeaders(
    snapshot([
      mergedEvent(
        alice,
        "elizaOS/proximityprize",
        "2026-09-10T00:00:00.000Z",
        6,
      ),
    ]),
    [],
    index([cycleEntry("delta-star", "2026-09", "closed-no-awards", [])]),
  );
  expect(leaders).toEqual([
    {
      actor: alice,
      score: 2,
      tokens: 0,
      projectedMinor: 0n,
      paidMinor: 0n,
      projects: 1,
      cycles: 1,
    },
  ]);
});

test("openMonthScores keeps an unlisted actor's event open", () => {
  const { openEvents } = openMonthScores(
    snapshot([
      mergedEvent(alice, "elizaOS/eliza", "2026-09-10T00:00:00.000Z", 9),
    ]),
    index([cycleEntry("eliza", "2026-09", "closed-no-awards", [])]),
  );
  expect(openEvents).toHaveLength(1);
});

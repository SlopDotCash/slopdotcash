/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import type { GitHubActor, ScoreEvent } from "../src/lib/leaderboard";
import { selectReviewerLeaders } from "../src/lib/reviewer-leaders";

// PRD LDR-03: equal primary values receive equal ranks; stable actor-ID
// ordering only stabilizes display. The reviewer ranking must follow the
// same competition-rank rule as every other leaderboard surface.

function actor(id: string, login: string): GitHubActor {
  return {
    id,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/${login}?size=96`,
    url: `https://github.com/${login}`,
    kind: "User",
  };
}

let seq = 0;
function reviewEvent(actorValue: GitHubActor, scoreThirds: number): ScoreEvent {
  seq += 1;
  return {
    id: `event-${seq}`,
    actor: actorValue,
    category: "substantive-review",
    points: scoreThirds / 3,
    scoreThirds,
    occurredAt: "2026-10-10T00:00:00.000Z",
    repository: "slopdotcash" as ScoreEvent["repository"],
    source: {
      id: `source-${seq}`,
      kind: "review",
      number: seq,
      title: "Review",
      url: `https://github.com/SlopDotCash/slopdotcash/pull/${seq}`,
    },
    reason: "test",
  };
}

const alice = actor("1001", "alice");
const bob = actor("1002", "bob");
const carol = actor("1003", "carol");
const dan = actor("1004", "dan");

describe("selectReviewerLeaders ranks", () => {
  it("gives equal review scores the same rank regardless of event count", () => {
    const leaders = selectReviewerLeaders([
      reviewEvent(alice, 30),
      reviewEvent(bob, 15),
      reviewEvent(bob, 15),
    ]);
    expect(leaders.map((leader) => [leader.actor.login, leader.rank])).toEqual([
      ["alice", 1],
      ["bob", 1],
    ]);
    // The event count stays available as secondary analysis data.
    expect(leaders[1]?.reviewEventCount).toBe(2);
  });

  it("skips the ranks a tie consumes", () => {
    const leaders = selectReviewerLeaders([
      reviewEvent(alice, 30),
      reviewEvent(bob, 15),
      reviewEvent(carol, 15),
      reviewEvent(dan, 6),
    ]);
    expect(leaders.map((leader) => [leader.actor.login, leader.rank])).toEqual([
      ["alice", 1],
      ["bob", 2],
      ["carol", 2],
      ["dan", 4],
    ]);
  });

  it("orders tied reviewers by actor ID, not by login", () => {
    // Login order (alice < zoe) disagrees with actor-ID order (1001 < 2002).
    const zoe = actor("1001", "zoe");
    const aliceById = actor("2002", "alice");
    const leaders = selectReviewerLeaders([
      reviewEvent(aliceById, 30),
      reviewEvent(zoe, 30),
    ]);
    expect(leaders.map((leader) => [leader.actor.login, leader.rank])).toEqual([
      ["zoe", 1],
      ["alice", 1],
    ]);
  });

  it("keeps sequential ranks for distinct review scores", () => {
    const leaders = selectReviewerLeaders([
      reviewEvent(alice, 30),
      reviewEvent(bob, 15),
      reviewEvent(carol, 6),
    ]);
    expect(leaders.map((leader) => leader.rank)).toEqual([1, 2, 3]);
  });
});

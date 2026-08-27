/**
 * Exercises reviewer selection: category filtering, third aggregation across
 * v2 and legacy events, deterministic ordering, and rejection of malformed
 * third counts.
 */

import { describe, expect, it } from "vitest";
import type { GitHubActor, ScoreEvent } from "./leaderboard";
import { formatThirds, selectReviewerLeaders } from "./reviewer-leaders";

function actor(id: string, login: string): GitHubActor {
  return {
    id,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/${login}?size=96`,
    url: `https://github.com/${login}`,
    kind: "User",
  };
}

function event(overrides: Partial<ScoreEvent> & { id: string }): ScoreEvent {
  return {
    actor: actor("U_reviewer", "reviewer-one"),
    category: "substantive-review",
    points: 1,
    scoreThirds: 3,
    occurredAt: "2026-08-10T10:00:00.000Z",
    repository: "elizaOS/eliza",
    source: {
      id: overrides.id,
      kind: "review",
      number: 25581,
      title: "Independent review",
      url: "https://github.com/elizaOS/eliza/pull/25581",
    },
    reason: "Substantive review of an accepted outcome.",
    ...overrides,
  };
}

describe("selectReviewerLeaders", () => {
  it("ranks only substantive-review points and keeps ordering deterministic", () => {
    const second = actor("U_second", "reviewer-two");
    const leaders = selectReviewerLeaders([
      event({ id: "rev_1" }),
      event({ id: "rev_2", actor: second, scoreThirds: 6, points: 2 }),
      event({ id: "rev_3", actor: second, scoreThirds: 3, points: 1 }),
      event({
        id: "pr_1",
        category: "merged-pull-request",
        scoreThirds: 30,
        points: 10,
      }),
    ]);
    expect(leaders).toHaveLength(2);
    expect(leaders[0]).toMatchObject({
      rank: 1,
      actor: { login: "reviewer-two" },
      reviewThirds: 9,
      reviewEventCount: 2,
    });
    expect(leaders[1]).toMatchObject({
      rank: 2,
      actor: { login: "reviewer-one" },
      reviewThirds: 3,
      reviewEventCount: 1,
    });
  });

  it("breaks exact ties by event count and then by login", () => {
    const alpha = actor("U_alpha", "alpha-reviewer");
    const beta = actor("U_beta", "beta-reviewer");
    const leaders = selectReviewerLeaders([
      event({ id: "rev_b", actor: beta, scoreThirds: 6, points: 2 }),
      event({ id: "rev_a1", actor: alpha, scoreThirds: 3, points: 1 }),
      event({ id: "rev_a2", actor: alpha, scoreThirds: 3, points: 1 }),
    ]);
    expect(leaders.map((leader) => leader.actor.login)).toEqual([
      "alpha-reviewer",
      "beta-reviewer",
    ]);
  });

  it("falls back to rounded points for legacy events without thirds", () => {
    const leaders = selectReviewerLeaders([
      event({ id: "rev_legacy", scoreThirds: undefined, points: 2 }),
    ]);
    expect(leaders[0]).toMatchObject({ reviewThirds: 6, reviewEventCount: 1 });
  });

  it("returns no leaders when the ledger has no scored reviews", () => {
    expect(
      selectReviewerLeaders([
        event({
          id: "pr_only",
          category: "merged-pull-request",
          scoreThirds: 1,
          points: 1 / 3,
        }),
      ]),
    ).toEqual([]);
  });

  it("rejects malformed review third counts instead of ranking them", () => {
    expect(() =>
      selectReviewerLeaders([
        event({ id: "rev_bad", scoreThirds: 2.5, points: 2.5 / 3 }),
      ]),
    ).toThrow(/non-integer third count/u);
  });
});

describe("formatThirds", () => {
  it("formats whole and fractional third counts", () => {
    expect(formatThirds(0)).toBe("0");
    expect(formatThirds(3)).toBe("1");
    expect(formatThirds(1)).toBe("0.33");
    expect(formatThirds(2)).toBe("0.67");
    expect(formatThirds(28)).toBe("9.33");
  });

  it("rejects negative and non-integer third counts", () => {
    expect(() => formatThirds(-3)).toThrow(RangeError);
    expect(() => formatThirds(1.5)).toThrow(RangeError);
  });
});

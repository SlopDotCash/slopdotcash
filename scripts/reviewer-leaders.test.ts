/**
 * The project leaderboard prints a leader's score net of any Slopbot
 * debit and, under it, how much of that score is review points. The
 * review figure used to be the gross review thirds, so a debit against
 * the same project month could leave the printed part larger than the
 * printed whole (a fully debited reviewer showed a total of 0 with
 * "Includes 300 review points" underneath). includedReviewThirds keeps
 * the part inside the whole, in the same proportion the project view
 * applies the debit to the score and the payment weight.
 */
import { describe, expect, test } from "bun:test";
import {
  includedReviewThirds,
  selectReviewerLeaders,
} from "../src/lib/reviewer-leaders";
import { eventThirds, penaltyDeductions } from "../src/lib/score-penalties";

const actor = {
  id: "111",
  login: "reviewer-a",
  avatarUrl: "https://avatars.githubusercontent.com/reviewer-a?size=96",
  url: "https://github.com/reviewer-a",
  kind: "User",
} as const;

function event(id: string, category: string, scoreThirds: number) {
  return {
    id,
    actor,
    category,
    points: scoreThirds / 3,
    scoreThirds,
    occurredAt: "2026-11-05T00:00:00.000Z",
    repository: "SlopDotCash/slopdotcash",
    source: {
      id: `s-${id}`,
      kind: "review",
      number: 1,
      title: "t",
      url: "https://example.com",
    },
    reason: "r",
  } as never;
}

function penalty(id: string, debitThirds: number) {
  return {
    id,
    actor,
    repository: "SlopDotCash/slopdotcash",
    occurredAt: "2026-11-06T00:00:00.000Z",
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds,
    source: {
      id: `p-${id}`,
      kind: "pull-request",
      number: 2,
      title: "t",
      url: "https://example.com",
    },
  } as never;
}

/** The leader row the project view builds, and its printed review part. */
function printed(events: never[], penalties: never[]) {
  const earnedThirds = events.reduce((total, e) => total + eventThirds(e), 0);
  const penaltyThirds =
    penaltyDeductions(events, penalties, () => "slopdotcash").byActor.get(
      actor.id,
    ) ?? 0;
  const scoreThirds = earnedThirds - penaltyThirds;
  const reviewer = selectReviewerLeaders(events).find(
    (entry) => entry.actor.id === actor.id,
  );
  return {
    scoreThirds,
    reviewThirds: reviewer
      ? includedReviewThirds(reviewer.reviewThirds, scoreThirds, penaltyThirds)
      : 0,
  };
}

describe("includedReviewThirds", () => {
  test("without a debit the gross review thirds are the exact part", () => {
    const row = printed(
      [
        event("a", "substantive-review", 30),
        event("b", "merged-pull-request", 30),
      ],
      [],
    );
    expect(row.scoreThirds).toBe(60);
    expect(row.reviewThirds).toBe(30);
    expect(includedReviewThirds(30, 60, 0)).toBe(30);
  });

  test("a debit that consumes the whole score leaves no review part", () => {
    const row = printed(
      [event("a", "substantive-review", 30)],
      [penalty("p", 30)],
    );
    expect(row.scoreThirds).toBe(0);
    expect(row.reviewThirds).toBe(0);
  });

  test("a partial debit scales the review part by the same proportion", () => {
    const row = printed(
      [
        event("a", "substantive-review", 30),
        event("b", "merged-pull-request", 30),
      ],
      [penalty("p", 45)],
    );
    expect(row.scoreThirds).toBe(15);
    // floor(30 * 15 / 60): the review share of the net score.
    expect(row.reviewThirds).toBe(7);
  });

  test("the part never exceeds the whole", () => {
    for (const [review, other, debit] of [
      [30, 0, 30],
      [30, 30, 45],
      [90, 10, 99],
      [3, 300, 1],
    ] as const) {
      const row = printed(
        [
          event("a", "substantive-review", review),
          event("b", "merged-pull-request", other),
        ],
        [penalty("p", debit)],
      );
      expect(row.reviewThirds).toBeLessThanOrEqual(
        Math.max(row.scoreThirds, 0),
      );
      expect(row.reviewThirds).toBeGreaterThanOrEqual(0);
    }
  });
});

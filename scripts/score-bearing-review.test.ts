/**
 * A review that already earned an evaluated award is a score-bearing source
 * (PRD section 7): the review pass skips it and records no second outcome.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

test("a review with an evaluated award is not also excluded or credited as a review", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([], AFTER_NOVEMBER);
  const pull = input.mergedPullRequests.find((p) => p.id === "PR_november");
  if (!pull) throw new Error("fixture pull request missing");
  const review = {
    id: "PRR_owner_review",
    url: `${pull.url}#pullrequestreview-1`,
    author: PROJECT_OWNER,
    state: "APPROVED" as const,
    body: "Checked the fix against the failing case.",
    submittedAt: "2026-11-04T12:00:00.000Z",
    comments: [],
  };
  input.mergedPullRequests = input.mergedPullRequests.map((p) =>
    p.id === pull.id ? { ...p, reviews: [review] } : p,
  ) as never;
  input.evaluatedContributions = [
    {
      id: "evaluation:owner-review",
      actor: PROJECT_OWNER,
      category: "evaluated-contribution",
      points: 1,
      scoreThirds: 3,
      occurredAt: review.submittedAt,
      repository: "elizaOS/asi",
      source: {
        id: review.id,
        kind: "review",
        number: pull.number,
        title: pull.title,
        url: review.url,
      },
      reason: "The review found the failing boundary before the merge.",
      evaluation: {
        decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
        reviewedAt: "2026-11-06T00:00:00.000Z",
        reviewer: "maintainer",
        manifestPath: "evaluations/asi/award-owner-review.json",
        manifestSha256: "a".repeat(64),
      },
    },
  ] as never;
  const snapshot = createLeaderboardSnapshot(input);
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === review.id)
      .map((event) => [event.category, event.actor.id]),
  ).toEqual([["evaluated-contribution", PROJECT_OWNER.id]]);
  expect(
    (snapshot.reviewExclusions ?? []).filter((exclusion) =>
      JSON.stringify(exclusion).includes(review.id),
    ),
  ).toEqual([]);
});

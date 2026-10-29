/// <reference types="bun-types" />
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  createLeaderboardSnapshot,
  PAYMENT_REVIEW_POLICY,
  PAYMENT_REVIEW_POLICY_AT,
  type PullRequestReview,
  paymentReviewSnapshot,
} from "../src/lib/leaderboard";
import { createPaymentProjectView } from "../src/lib/project-view";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

function review(
  partial: Partial<PullRequestReview> & {
    id: string;
    submittedAt: string;
    number: number;
  },
): PullRequestReview {
  return {
    body: "Looks correct and covers the regression path.",
    state: "APPROVED",
    url: `https://github.com/SlopDotCash/asi/pull/7#pullrequestreview-${partial.number}`,
    author: PROJECT_OWNER,
    inlineCommentCount: 1,
    commitId: "7".repeat(40),
    ...partial,
  };
}

/** Fresh census so review edits do not leak across tests. */
function inputWithOctoberReviews(reviews: PullRequestReview[]) {
  const input = penaltyScoreInput([]);
  return {
    ...input,
    mergedPullRequests: input.mergedPullRequests.map((pull) =>
      pull.id === "PR_october"
        ? { ...pull, reviews: [...reviews] }
        : { ...pull, reviews: [...pull.reviews] },
    ),
  };
}

describe("paymentReviewBasis omission (#1411 S3)", () => {
  test("omits the basis when no formal review was submitted before the payment cutoff", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const input = inputWithOctoberReviews([
      review({
        id: "PRR_after_cutoff",
        number: 9001,
        submittedAt: "2026-10-20T12:00:00.000Z",
      }),
    ]);

    const snapshot = createLeaderboardSnapshot(input);
    expect(snapshot.paymentReviewBasis).toBeUndefined();
    expect(paymentReviewSnapshot(snapshot)).toEqual(snapshot);
    expect(() =>
      createPaymentProjectView(snapshot, "asi", "2026-10"),
    ).not.toThrow();
  });

  test("omits the basis when the census has no reviews at all", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const snapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
    expect(snapshot.paymentReviewBasis).toBeUndefined();
  });

  test("keeps the basis when a pre-cutoff review makes score and payment diverge", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const input = inputWithOctoberReviews([
      review({
        id: "PRR_between_cutoffs",
        number: 9002,
        // After the score cutoff (Oct 1), before the payment cutoff (Oct 9).
        submittedAt: "2026-10-05T12:00:00.000Z",
      }),
    ]);

    const snapshot = createLeaderboardSnapshot(input);
    const basis = snapshot.paymentReviewBasis;
    expect(basis).toBeDefined();
    expect(basis?.policy).toBe(PAYMENT_REVIEW_POLICY);
    expect(basis?.effectiveAt).toBe(PAYMENT_REVIEW_POLICY_AT);
    expect(basis?.leaders.length).toBeGreaterThan(0);

    const payment = paymentReviewSnapshot(snapshot);
    const scoreReviewIds = new Set(
      snapshot.ledger
        .filter((event) => event.category === "substantive-review")
        .map((event) => event.source.id),
    );
    const paymentReviewIds = new Set(
      payment.ledger
        .filter((event) => event.category === "substantive-review")
        .map((event) => event.source.id),
    );
    expect(scoreReviewIds.has("PRR_between_cutoffs")).toBe(false);
    expect(paymentReviewIds.has("PRR_between_cutoffs")).toBe(true);
    expect(
      input.mergedPullRequests.find((row) => row.id === "PR_october")?.author
        ?.id,
    ).toBe(PENALIZED_AUTHOR.id);
  });
});

/// <reference types="bun-types" />
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  createLeaderboardSnapshot,
  PAYMENT_REVIEW_BASIS_OMITTED_REASON,
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
  test("publishes an omission marker when no formal review was submitted before the payment cutoff", () => {
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
    expect(snapshot.paymentReviewBasisOmitted).toEqual({
      policy: PAYMENT_REVIEW_POLICY,
      effectiveAt: PAYMENT_REVIEW_POLICY_AT,
      reason: PAYMENT_REVIEW_BASIS_OMITTED_REASON,
    });
    const payment = paymentReviewSnapshot(snapshot);
    expect(payment.paymentReviewBasisOmitted).toBeUndefined();
    expect(payment.ledger).toEqual(snapshot.ledger);
    expect(payment.leaders).toEqual(snapshot.leaders);
    expect(() =>
      createPaymentProjectView(snapshot, "asi", "2026-10"),
    ).not.toThrow();
  });

  test("publishes the omission marker when the census has no reviews at all", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const snapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
    expect(snapshot.paymentReviewBasis).toBeUndefined();
    expect(snapshot.paymentReviewBasisOmitted).toEqual({
      policy: PAYMENT_REVIEW_POLICY,
      effectiveAt: PAYMENT_REVIEW_POLICY_AT,
      reason: PAYMENT_REVIEW_BASIS_OMITTED_REASON,
    });
    expect(paymentReviewSnapshot(snapshot).ledger).toEqual(snapshot.ledger);
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
    expect(snapshot.paymentReviewBasisOmitted).toBeUndefined();
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

  test("Shaw counterexample: stripping only paymentReviewBasis refuses instead of falling back", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const input = inputWithOctoberReviews([
      review({
        id: "PRR_before",
        number: 9003,
        submittedAt: "2026-10-05T12:00:00.000Z",
      }),
    ]);
    const intact = createLeaderboardSnapshot(input);
    expect(intact.paymentReviewBasis).toBeDefined();
    const paymentIds = new Set(
      paymentReviewSnapshot(intact)
        .ledger.filter((event) => event.category === "substantive-review")
        .map((event) => event.source.id),
    );
    expect(paymentIds.has("PRR_before")).toBe(true);

    const stripped = {
      ...intact,
      paymentReviewBasis: undefined,
    };
    expect(() => paymentReviewSnapshot(stripped)).toThrow(
      /production-release review basis/i,
    );
  });

  test("refuses an omission marker that coexists with a published basis", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    const input = inputWithOctoberReviews([
      review({
        id: "PRR_before",
        number: 9004,
        submittedAt: "2026-10-05T12:00:00.000Z",
      }),
    ]);
    const intact = createLeaderboardSnapshot(input);
    const inconsistent = {
      ...intact,
      paymentReviewBasisOmitted: {
        policy: PAYMENT_REVIEW_POLICY,
        effectiveAt: PAYMENT_REVIEW_POLICY_AT,
        reason: PAYMENT_REVIEW_BASIS_OMITTED_REASON,
      },
    };
    expect(() => paymentReviewSnapshot(inconsistent)).toThrow(
      /both a review basis and an omission marker/i,
    );
  });

  test("refuses a forged omission marker when the score ledger still has a pre-cutoff review", () => {
    setSystemTime(new Date(AFTER_NOVEMBER));
    // Oct 5 CHANGES_REQUESTED of a non-head commit scores under outcome-first
    // and remains payment-eligible, so it stays on the score ledger before the
    // payment cutoff. Forging an omission marker after stripping the basis must
    // still refuse.
    const input = inputWithOctoberReviews([
      review({
        id: "PRR_cr_before",
        number: 9005,
        submittedAt: "2026-10-05T12:00:00.000Z",
        state: "CHANGES_REQUESTED",
        body: "Please fix the regression path before merge.",
        commitId: "a".repeat(40),
      }),
    ]);
    const intact = createLeaderboardSnapshot(input);
    expect(intact.paymentReviewBasis).toBeDefined();
    expect(
      intact.ledger.some(
        (event) =>
          event.category === "substantive-review" &&
          event.source.id === "PRR_cr_before" &&
          Date.parse(event.occurredAt) < Date.parse(PAYMENT_REVIEW_POLICY_AT),
      ),
    ).toBe(true);

    const forged = {
      ...intact,
      paymentReviewBasis: undefined,
      paymentReviewBasisOmitted: {
        policy: PAYMENT_REVIEW_POLICY,
        effectiveAt: PAYMENT_REVIEW_POLICY_AT,
        reason: PAYMENT_REVIEW_BASIS_OMITTED_REASON,
      },
    };
    expect(() => paymentReviewSnapshot(forged)).toThrow(/pre-cutoff review/i);
  });
});

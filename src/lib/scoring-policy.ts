/**
 * Versioned selection of the Slop Score producer for new work (PRD section 7;
 * SCR-04, SCR-05, SCR-06; MVP-09, MVP-05a).
 *
 * Work accepted before the selected policy's effective instant keeps the
 * Slop Score v2 and SCR-05 rules in `leaderboard.ts` unchanged. Work accepted
 * from that instant is scored from Slopbot's source-bound value assessments;
 * a valid maintainer ratification remains the exception that takes
 * precedence. Payment authority stays separate: a score is never an award.
 */
import { VALUE_RUBRIC_VERSION } from "./value-assessment";

export const VALUE_SCORING_POLICY_ID = "slop-value-v1" as const;

/** PRD section 7: up to the first five distinct qualifying reviewers. */
export const MAX_CREDITED_REVIEWERS = 5 as const;

/**
 * Owner decision D2 (24 Oct 2026).
 *
 * - `effectiveAt`: work accepted from this exact UTC instant uses the value
 *   policy. Earlier work keeps its historical policy.
 * - Review pool: one pool per pull request. It is the sum of the credited
 *   reviewers' highest assessed bands, capped at the pull request's own
 *   assessed size in thirds, and never less than one third.
 */
export const VALUE_SCORING_POLICY_EFFECTIVE_AT =
  "2026-11-01T00:00:00.000Z" as const;
export const REVIEW_CREDIT_POOL_RULE = "credited-bands-capped-at-size" as const;
/** The smallest review pool of a pull request with a credited reviewer. */
export const MIN_REVIEW_CREDIT_POOL_THIRDS = 1 as const;

export interface ValueScoringPolicy {
  id: typeof VALUE_SCORING_POLICY_ID;
  rubricVersion: string;
  effectiveAt: string;
  reviewCredit: {
    maxReviewers: typeof MAX_CREDITED_REVIEWERS;
    pool: typeof REVIEW_CREDIT_POOL_RULE;
  };
}

const EXACT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Throws unless the policy is complete and well formed. */
export function assertValueScoringPolicy(
  policy: ValueScoringPolicy,
): ValueScoringPolicy {
  if (
    policy.id !== VALUE_SCORING_POLICY_ID ||
    policy.rubricVersion !== VALUE_RUBRIC_VERSION ||
    policy.reviewCredit.maxReviewers !== MAX_CREDITED_REVIEWERS ||
    policy.reviewCredit.pool !== REVIEW_CREDIT_POOL_RULE
  )
    throw new TypeError("Value scoring policy has an unknown version");
  if (
    !EXACT_UTC.test(policy.effectiveAt) ||
    new Date(policy.effectiveAt).toISOString() !== policy.effectiveAt
  )
    throw new TypeError(
      "Value scoring policy effectiveAt must be an exact UTC timestamp",
    );
  return policy;
}

/** The recorded policy for new work. */
export function valueScoringPolicy(): ValueScoringPolicy {
  return assertValueScoringPolicy({
    id: VALUE_SCORING_POLICY_ID,
    rubricVersion: VALUE_RUBRIC_VERSION,
    effectiveAt: VALUE_SCORING_POLICY_EFFECTIVE_AT,
    reviewCredit: {
      maxReviewers: MAX_CREDITED_REVIEWERS,
      pool: REVIEW_CREDIT_POOL_RULE,
    },
  });
}

/**
 * The review pool of one pull request: the credited reviewers' bands, capped
 * at the pull request's assessed size, with a minimum of one third. A lone
 * small review cannot earn a large pool, and reviews cannot outweigh the work.
 */
export function reviewCreditPoolThirds(
  creditedBands: readonly number[],
  assessedSizeThirds: number,
): number {
  if (!Number.isSafeInteger(assessedSizeThirds) || assessedSizeThirds < 0)
    throw new RangeError("Assessed size must be a non-negative integer");
  const bands = creditedBands.reduce((sum, band) => sum + band, 0);
  return Math.max(
    MIN_REVIEW_CREDIT_POOL_THIRDS,
    Math.min(bands, assessedSizeThirds),
  );
}

/**
 * Splits an integer pool by positive integer weights with the largest
 * remainder method. Equal remainders go to the earlier position, so callers
 * pass weights in credited-reviewer order. The shares always sum to the pool.
 */
export function allocateReviewCredit(
  poolThirds: number,
  weights: readonly number[],
): number[] {
  if (!Number.isSafeInteger(poolThirds) || poolThirds < 1)
    throw new RangeError("Review credit pool must be a positive integer");
  if (
    weights.length === 0 ||
    weights.length > MAX_CREDITED_REVIEWERS ||
    weights.some((weight) => !Number.isSafeInteger(weight) || weight < 1)
  )
    throw new RangeError(
      `Review credit needs one to ${MAX_CREDITED_REVIEWERS} positive integer weights`,
    );
  const pool = BigInt(poolThirds);
  const total = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const shares = weights.map((weight) => (pool * BigInt(weight)) / total);
  const remainders = weights.map((weight) => (pool * BigInt(weight)) % total);
  let left = pool - shares.reduce((sum, share) => sum + share, 0n);
  const order = weights
    .map((_, index) => index)
    .sort((a, b) =>
      remainders[a] === remainders[b]
        ? a - b
        : (remainders[b] as bigint) > (remainders[a] as bigint)
          ? 1
          : -1,
    );
  for (const index of order) {
    if (left === 0n) break;
    shares[index] = (shares[index] as bigint) + 1n;
    left -= 1n;
  }
  return shares.map(Number);
}

export interface QualifyingReview<Actor extends { id: string }> {
  reviewId: string;
  actor: Actor;
  submittedAt: string;
  /** Assessed review band in thirds; only positive values qualify. */
  thirds: number;
}

export interface CreditedReviewer<Actor extends { id: string }> {
  actor: Actor;
  /** The reviewer's highest-band review; the one source record credited. */
  source: QualifyingReview<Actor>;
  shareThirds: number;
  /** The reviewer's other qualifying reviews; they add no credit. */
  repeatedReviewIds: string[];
}

export interface ReviewCreditAllocation<Actor extends { id: string }> {
  /** The pool shared by the credited reviewers; zero when nobody qualifies. */
  poolThirds: number;
  credited: CreditedReviewer<Actor>[];
  /** Qualifying reviews by reviewers after the first five. */
  beyondLimitReviewIds: string[];
}

function compareReviewTime(
  left: { submittedAt: string; reviewId: string },
  right: { submittedAt: string; reviewId: string },
): number {
  const difference =
    Date.parse(left.submittedAt) - Date.parse(right.submittedAt);
  if (difference !== 0) return difference;
  return left.reviewId < right.reviewId
    ? -1
    : left.reviewId > right.reviewId
      ? 1
      : 0;
}

/**
 * One explicit allocation for one pull request: dedupe by immutable reviewer
 * ID, order reviewers by their first qualifying review (submission time, then
 * review node ID), credit the first five, and split the pull request's pool
 * (`reviewCreditPoolThirds`) by assessed band.
 * A reviewer's weight is their highest band, so repeated reviews cannot grow a
 * share. Callers exclude self-review, bot, post-merge and duplicate findings
 * before this step.
 */
export function allocatePullRequestReviewCredit<Actor extends { id: string }>(
  reviews: readonly QualifyingReview<Actor>[],
  assessedSizeThirds: number,
): ReviewCreditAllocation<Actor> {
  const seen = new Set<string>();
  const byReviewer = new Map<string, QualifyingReview<Actor>[]>();
  for (const review of reviews) {
    if (seen.has(review.reviewId))
      throw new Error("Review credit received a repeated review source");
    seen.add(review.reviewId);
    if (!Number.isFinite(Date.parse(review.submittedAt)))
      throw new Error("Qualifying review lacks a verified submission time");
    if (!Number.isSafeInteger(review.thirds) || review.thirds < 1)
      throw new RangeError("Qualifying review needs a positive band");
    const list = byReviewer.get(review.actor.id) ?? [];
    list.push(review);
    byReviewer.set(review.actor.id, list);
  }
  const reviewers = [...byReviewer.values()]
    .map((list) => {
      const ordered = [...list].sort(compareReviewTime);
      const first = ordered[0] as QualifyingReview<Actor>;
      const source = ordered.reduce((best, review) =>
        review.thirds > best.thirds ? review : best,
      );
      return { first, source, ordered };
    })
    .sort(
      (left, right) =>
        compareReviewTime(left.first, right.first) ||
        (left.first.actor.id < right.first.actor.id ? -1 : 1),
    );
  const creditedReviewers = reviewers.slice(0, MAX_CREDITED_REVIEWERS);
  const bands = creditedReviewers.map((reviewer) => reviewer.source.thirds);
  const poolThirds = bands.length
    ? reviewCreditPoolThirds(bands, assessedSizeThirds)
    : 0;
  const shares = bands.length ? allocateReviewCredit(poolThirds, bands) : [];
  return {
    poolThirds,
    credited: creditedReviewers.map((reviewer, index) => ({
      actor: reviewer.source.actor,
      source: reviewer.source,
      shareThirds: shares[index] as number,
      repeatedReviewIds: reviewer.ordered
        .filter((review) => review !== reviewer.source)
        .map((review) => review.reviewId),
    })),
    beyondLimitReviewIds: reviewers
      .slice(MAX_CREDITED_REVIEWERS)
      .flatMap((reviewer) => reviewer.ordered.map((review) => review.reviewId)),
  };
}

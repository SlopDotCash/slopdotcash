/**
 * Versioned selection of the accepted-work Points producer (PRD section 7;
 * SCR-04, SCR-05, SCR-06; MVP-09, MVP-05a).
 *
 * Work accepted before the selected policy's effective instant keeps the
 * Slop Score v2 and SCR-05 rules in `leaderboard.ts` unchanged. Work accepted
 * from that instant is scored from Slopbot's source-bound value assessments;
 * a valid maintainer ratification remains the exception that takes
 * precedence. Payment authority stays separate: a score is never an award.
 */
import { isExactUtc } from "./record-validation.mjs";
import { VALUE_RUBRIC_VERSION } from "./value-assessment";
import { allocateWeighted } from "./verified-allocation";
import { selectReviewers } from "./verified-reviewers";
import { cappedTotal } from "./verified-selection";

/** PRD section 7: up to the first five distinct qualifying reviewers. */
export const MAX_CREDITED_REVIEWERS = 5 as const;

export const VALUE_SCORING_POLICY_ID = "slop-value-v1" as const;

/**
 * Owner decisions of 24 and 25 October 2026.
 *
 * - Approved scope includes unpaid September and October historical work.
 *   Approved or funded awards retain their frozen sources and amounts.
 *   Historical publication waits for complete import and reconciliation.
 *   This scope does not authorize paid API assessment of historical work.
 * - Review pool: one pool per pull request. It is the sum of the credited
 *   reviewers' highest assessed bands, capped at the pull request's own
 *   assessed size in thirds, and never less than one third.
 */
export const VALUE_SCORING_APPROVED_HISTORY_FROM =
  "2026-09-01T00:00:00.000Z" as const;
/** Normal publication stays on the prior boundary until historical coverage
 * and exact Points changes are reconciled. Explicit offline candidates may
 * use the approved September scope above. Remove this hold in a reviewed
 * source change after that evidence is complete; no runtime flag enables it.
 */
const VALUE_SCORING_POLICY_EFFECTIVE_AT = "2026-11-01T00:00:00.000Z" as const;
export const REVIEW_CREDIT_POOL_RULE = "credited-bands-capped-at-size" as const;
/** The smallest review pool of a pull request with a credited reviewer. */
const MIN_REVIEW_CREDIT_POOL_THIRDS = 1 as const;

export interface ValueScoringPolicy {
  id: typeof VALUE_SCORING_POLICY_ID;
  rubricVersion: string;
  effectiveAt: string;
  reviewCredit: {
    maxReviewers: typeof MAX_CREDITED_REVIEWERS;
    pool: typeof REVIEW_CREDIT_POOL_RULE;
  };
}

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
  if (!isExactUtc(policy.effectiveAt))
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
function reviewCreditPoolThirds(
  creditedBands: readonly number[],
  assessedSizeThirds: number,
): number {
  if (!Number.isSafeInteger(assessedSizeThirds) || assessedSizeThirds < 0)
    throw new RangeError("Assessed size must be a non-negative integer");
  return cappedTotal(
    [...creditedBands],
    assessedSizeThirds,
    MIN_REVIEW_CREDIT_POOL_THIRDS,
  );
}

/**
 * Splits an integer pool by positive integer weights with the largest
 * remainder method. Equal remainders go to the earlier position, so callers
 * pass weights in credited-reviewer order. The shares always sum to the pool.
 */
function allocateReviewCredit(
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
  return allocateWeighted(
    BigInt(poolThirds),
    weights.map((weight) => BigInt(weight)),
  ).amounts.map(Number);
}

export interface QualifyingReview<Actor extends { id: string }> {
  reviewId: string;
  actor: Actor;
  submittedAt: string;
  /** Assessed review band in thirds; only positive values qualify. */
  thirds: number;
}

interface CreditedReviewer<Actor extends { id: string }> {
  actor: Actor;
  /** The reviewer's highest-band review; the one source record credited. */
  source: QualifyingReview<Actor>;
  shareThirds: number;
  /** The reviewer's other qualifying reviews; they add no credit. */
  repeatedReviewIds: string[];
}

interface ReviewCreditAllocation<Actor extends { id: string }> {
  /** The pool shared by the credited reviewers; zero when nobody qualifies. */
  poolThirds: number;
  credited: CreditedReviewer<Actor>[];
  /** Qualifying reviews by reviewers after the first five. */
  beyondLimitReviewIds: string[];
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
  const actorIndexes = new Map<string, number>();
  const timed: { review: QualifyingReview<Actor>; submittedAt: number }[] = [];
  for (const review of reviews) {
    if (seen.has(review.reviewId))
      throw new Error("Review credit received a repeated review source");
    seen.add(review.reviewId);
    const submittedAt = Date.parse(review.submittedAt);
    if (!Number.isFinite(submittedAt))
      throw new Error("Qualifying review lacks a verified submission time");
    if (!Number.isSafeInteger(review.thirds) || review.thirds < 1)
      throw new RangeError("Qualifying review needs a positive band");
    if (!actorIndexes.has(review.actor.id))
      actorIndexes.set(review.actor.id, actorIndexes.size);
    timed.push({ review, submittedAt });
  }
  // Unique review IDs make this the same total order used within each old
  // actor group and between their first reviews. Actor metadata stays on the
  // selected source object; only immutable IDs become dense scan indexes.
  const ordered = timed
    .sort(
      (left, right) =>
        left.submittedAt - right.submittedAt ||
        (left.review.reviewId < right.review.reviewId
          ? -1
          : left.review.reviewId > right.review.reviewId
            ? 1
            : 0),
    )
    .map(({ review }) => review);
  const grouped: QualifyingReview<Actor>[][] = Array.from(
    { length: actorIndexes.size },
    () => [],
  );
  const entries = ordered.map((review) => {
    const actor = actorIndexes.get(review.actor.id) as number;
    grouped[actor].push(review);
    return { actor, thirds: review.thirds };
  });
  const selection = selectReviewers(
    actorIndexes.size,
    entries,
    MAX_CREDITED_REVIEWERS,
  );
  const reviewers = selection.actors.map((actor) => ({
    source: ordered[selection.sources[actor]] as QualifyingReview<Actor>,
    ordered: grouped[actor],
  }));
  const creditedReviewers = reviewers.slice(0, selection.creditedCount);
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
      .slice(selection.creditedCount)
      .flatMap((reviewer) => reviewer.ordered.map((review) => review.reviewId)),
  };
}

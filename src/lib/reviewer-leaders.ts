/**
 * Selects the reviewer slice of a project cycle from accepted score events.
 * Review points currently share the single monthly pool with authored work;
 * this view only makes the review contribution visible as its own ranking and
 * never changes scoring, shares, or payouts.
 */

import {
  assignLeaderboardRanks,
  compareRankedEntries,
  type GitHubActor,
  type ScoreEvent,
} from "./leaderboard";
import { eventThirds } from "./score-penalties";

export interface ReviewerLeader {
  rank: number;
  actor: GitHubActor;
  reviewThirds: number;
  reviewEventCount: number;
}

/**
 * The review part of one leader's displayed score. The displayed score is
 * net of the actor's Slopbot debit, and the project view lowers the score
 * in the same proportion as the payment weight, so the review part of the
 * net score is that same proportion of the gross review thirds. Without a
 * debit the gross thirds are the exact part; with one, the gross figure
 * could exceed the whole net score it is presented as a part of.
 */
export function includedReviewThirds(
  reviewThirds: number,
  scoreThirds: number,
  penaltyThirds: number,
): number {
  const earnedThirds = scoreThirds + penaltyThirds;
  if (penaltyThirds === 0 || earnedThirds <= 0) return reviewThirds;
  return Math.floor((reviewThirds * scoreThirds) / earnedThirds);
}

export function selectReviewerLeaders(
  ledger: readonly ScoreEvent[],
): ReviewerLeader[] {
  const byActor = new Map<
    string,
    { actor: GitHubActor; reviewThirds: number; reviewEventCount: number }
  >();
  for (const event of ledger) {
    if (event.category !== "substantive-review") continue;
    const thirds = eventThirds(event);
    const current = byActor.get(event.actor.id) ?? {
      actor: event.actor,
      reviewThirds: 0,
      reviewEventCount: 0,
    };
    current.actor = event.actor;
    current.reviewThirds += thirds;
    current.reviewEventCount += 1;
    byActor.set(event.actor.id, current);
  }
  // LDR-03: equal primary values receive equal ranks, and stable actor-ID
  // ordering only stabilizes display. The review event count is secondary
  // analysis data; it must not split a tie in the primary review score.
  const ranked = [...byActor.values()]
    .filter((entry) => entry.reviewThirds > 0)
    .map((entry) => ({
      rank: 0,
      scoreThirds: entry.reviewThirds,
      actor: entry.actor,
      reviewThirds: entry.reviewThirds,
      reviewEventCount: entry.reviewEventCount,
    }))
    .sort(compareRankedEntries);
  assignLeaderboardRanks(ranked);
  return ranked.map((entry) => ({
    rank: entry.rank,
    actor: entry.actor,
    reviewThirds: entry.reviewThirds,
    reviewEventCount: entry.reviewEventCount,
  }));
}

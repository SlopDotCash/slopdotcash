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

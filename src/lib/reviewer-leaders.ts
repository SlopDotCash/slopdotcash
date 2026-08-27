/**
 * Selects the reviewer slice of a project cycle from accepted score events.
 * Review points currently share the single monthly pool with authored work;
 * this view only makes the review contribution visible as its own ranking and
 * never changes scoring, shares, or payouts.
 */

import type { GitHubActor, ScoreEvent } from "./leaderboard";

export interface ReviewerLeader {
  rank: number;
  actor: GitHubActor;
  reviewThirds: number;
  reviewEventCount: number;
}

function compareActors(left: GitHubActor, right: GitHubActor): number {
  const leftLogin = left.login.toLowerCase();
  const rightLogin = right.login.toLowerCase();
  return (
    leftLogin.localeCompare(rightLogin) ||
    left.login.localeCompare(right.login) ||
    left.id.localeCompare(right.id)
  );
}

/** Formats an integer third count as a score with at most two decimals. */
export function formatThirds(thirds: number): string {
  if (!Number.isSafeInteger(thirds) || thirds < 0) {
    throw new RangeError(`Invalid third count: ${thirds}`);
  }
  if (thirds % 3 === 0) return String(thirds / 3);
  return (thirds / 3).toFixed(2);
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
    const thirds = event.scoreThirds ?? Math.round(event.points * 3);
    if (!Number.isSafeInteger(thirds) || thirds < 0) {
      throw new TypeError(
        `Review event ${event.id} has a non-integer third count`,
      );
    }
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
  return [...byActor.values()]
    .filter((entry) => entry.reviewThirds > 0)
    .sort(
      (left, right) =>
        right.reviewThirds - left.reviewThirds ||
        right.reviewEventCount - left.reviewEventCount ||
        compareActors(left.actor, right.actor),
    )
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

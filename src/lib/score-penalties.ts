/**
 * Applies published Slopbot debits to Slop Score (PRD section 7, owner
 * decision D7). Every reader of the score uses this one function on its own
 * event set, so the snapshot, project views and the global ranking agree.
 *
 * A debit reduces only its actor's score for the same project and UTC month,
 * and never below zero. The debit is state, not an event stream: a reversed
 * debit is absent from the feed, so the next snapshot no longer applies it,
 * and a replayed debit is the same row, so it applies once. Closed reward
 * cycles bind their own snapshot bytes, so a later debit never changes an
 * approved, scheduled or paid award.
 */
import type { PublishedPenalty, ScoreEvent } from "./leaderboard-types";

export interface PenaltyDeductions {
  /** Applied thirds per actor ID. */
  byActor: Map<string, number>;
  /** Applied thirds per penalty ID. */
  byPenalty: Map<string, number>;
}

export function eventThirds(
  event: Pick<ScoreEvent, "scoreThirds" | "points">,
): number {
  return event.scoreThirds ?? Math.round(event.points * 3);
}

export function penaltyDeductions(
  events: readonly Pick<
    ScoreEvent,
    "actor" | "repository" | "occurredAt" | "scoreThirds" | "points"
  >[],
  penalties: readonly PublishedPenalty[],
  projectOf: (repository: string) => string,
  extraCredit?: ReadonlyMap<string, number>,
): PenaltyDeductions {
  const key = (actorId: string, repository: string, occurredAt: string) =>
    `${actorId}\0${projectOf(repository)}\0${occurredAt.slice(0, 7)}`;
  const available = new Map<string, number>();
  for (const event of events) {
    const bucket = key(event.actor.id, event.repository, event.occurredAt);
    available.set(bucket, (available.get(bucket) ?? 0) + eventThirds(event));
  }
  // Credit the rolling events do not carry, such as a retained award the
  // snapshot no longer lists, still bounds the month's debit.
  for (const [bucket, thirds] of extraCredit ?? [])
    if (Number.isSafeInteger(thirds) && thirds > 0)
      available.set(bucket, (available.get(bucket) ?? 0) + thirds);
  const byActor = new Map<string, number>();
  const byPenalty = new Map<string, number>();
  for (const penalty of [...penalties].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  )) {
    const bucket = key(
      penalty.actor.id,
      penalty.repository,
      penalty.occurredAt,
    );
    const applied = Math.min(penalty.debitThirds, available.get(bucket) ?? 0);
    if (applied <= 0) continue;
    available.set(bucket, (available.get(bucket) ?? 0) - applied);
    byPenalty.set(penalty.id, applied);
    byActor.set(
      penalty.actor.id,
      (byActor.get(penalty.actor.id) ?? 0) + applied,
    );
  }
  return { byActor, byPenalty };
}

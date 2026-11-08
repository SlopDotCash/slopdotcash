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
import type {
  PenaltyHistoryRecord,
  PublishedPenalty,
  ScoreEvent,
} from "./leaderboard-types";
import { consumeBuckets, sumBuckets } from "./verified-aggregation";

/** Retained history is explicit evidence, never an absence-based reversal. */
export function assertPenaltyHistory(
  value: unknown,
  projectIds: readonly string[],
  through?: string,
): asserts value is PenaltyHistoryRecord[] {
  if (!Array.isArray(value)) throw new Error("Invalid penalty history");
  const seen = new Set<string>();
  const iso = (at: unknown): at is string =>
    typeof at === "string" &&
    Number.isFinite(Date.parse(at)) &&
    new Date(at).toISOString() === at;
  for (const row of value as PenaltyHistoryRecord[]) {
    if (
      !row ||
      typeof row !== "object" ||
      Object.keys(row).sort().join() !==
        [
          "projectId",
          "itemNodeId",
          "authorGithubId",
          "category",
          "tableVersion",
          "debitThirds",
          "period",
          "recordedAt",
          "reversedAt",
          "reversal",
        ]
          .sort()
          .join() ||
      !projectIds.includes(row.projectId) ||
      typeof row.itemNodeId !== "string" ||
      !/^[A-Za-z0-9_=-]{1,100}$/u.test(row.itemNodeId) ||
      typeof row.authorGithubId !== "string" ||
      !/^[1-9][0-9]*$/u.test(row.authorGithubId) ||
      !/^[a-z_]{1,40}$/u.test(row.category) ||
      !/^slopbot-penalties-v[1-9][0-9]*$/u.test(row.tableVersion) ||
      !Number.isSafeInteger(row.debitThirds) ||
      row.debitThirds < 1 ||
      !Number.isSafeInteger(row.debitThirds * 10) ||
      !iso(row.recordedAt) ||
      row.period !== row.recordedAt.slice(0, 7) ||
      (through !== undefined && row.recordedAt > through) ||
      (row.reversedAt === null
        ? row.reversal !== null
        : !iso(row.reversedAt) ||
          row.reversedAt < row.recordedAt ||
          (through !== undefined && row.reversedAt > through) ||
          !["appeal_upheld", "maintainer_reopen"].includes(row.reversal ?? ""))
    )
      throw new Error("Invalid penalty history record");
    const key = `${row.projectId}\0${row.itemNodeId}`;
    if (seen.has(key))
      throw new Error("Penalty history repeats a pull request");
    seen.add(key);
  }
}

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
): PenaltyDeductions {
  const key = (actorId: string, repository: string, occurredAt: string) =>
    `${actorId}\0${projectOf(repository)}\0${occurredAt.slice(0, 7)}`;
  const buckets = new Map<string, number>();
  const bucketIndex = (value: string): number => {
    const existing = buckets.get(value);
    if (existing !== undefined) return existing;
    const index = buckets.size;
    buckets.set(value, index);
    return index;
  };
  const credits: { bucket: number; amount: bigint }[] = [];
  for (const event of events) {
    const bucket = key(event.actor.id, event.repository, event.occurredAt);
    credits.push({
      bucket: bucketIndex(bucket),
      amount: BigInt(eventThirds(event)),
    });
  }
  const ordered = [...penalties].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  const requests = ordered.map((penalty) => ({
    bucket: bucketIndex(
      key(penalty.actor.id, penalty.repository, penalty.occurredAt),
    ),
    // A nonpositive request applied nothing in the original loop.
    amount: penalty.debitThirds > 0 ? BigInt(penalty.debitThirds) : 0n,
  }));
  const consumed = consumeBuckets(sumBuckets(buckets.size, credits), requests);
  const byActor = new Map<string, number>();
  const byPenalty = new Map<string, number>();
  const actors = new Map<string, number>();
  const actorCredits: { bucket: number; amount: bigint }[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const penalty = ordered[index];
    const exact = consumed.applied[index];
    if (exact <= 0n) continue;
    const applied = Number(exact);
    if (!Number.isSafeInteger(applied))
      throw new Error("Penalty total overflow");
    if (!actors.has(penalty.actor.id))
      actors.set(penalty.actor.id, actors.size);
    actorCredits.push({
      bucket: actors.get(penalty.actor.id) as number,
      amount: exact,
    });
    byPenalty.set(penalty.id, applied);
  }
  const actorTotals = sumBuckets(actors.size, actorCredits);
  for (const [actor, index] of actors) {
    const numericTotal = Number(actorTotals[index]);
    if (!Number.isSafeInteger(numericTotal))
      throw new Error("Penalty total overflow");
    byActor.set(actor, numericTotal);
  }
  return { byActor, byPenalty };
}

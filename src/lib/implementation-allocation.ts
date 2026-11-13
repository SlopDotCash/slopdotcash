import { scoreThirdsToPoints } from "./score-units";
import { allocateWeighted } from "./verified-allocation";

/**
 * Apportion an accepted outcome's existing score by verified changed lines.
 * Actor IDs, rather than source order or PR authorship, break remainder ties.
 * Complete zero-line evidence keeps equal sharing for binary or empty diffs.
 */
export function shareImplementationPoints(
  totalPoints: number,
  actorIds: readonly string[],
  lineWeights: ReadonlyMap<string, bigint>,
): number[] {
  if (!Number.isSafeInteger(totalPoints) || totalPoints < 0) {
    throw new TypeError("implementation score must be a nonnegative integer");
  }
  if (actorIds.length === 0 || new Set(actorIds).size !== actorIds.length) {
    throw new TypeError("implementation actors must be nonempty and unique");
  }
  const actors = actorIds.map((id, index) => {
    const weight = lineWeights.get(id);
    if (!id || typeof weight !== "bigint" || weight < 0n) {
      throw new TypeError("implementation actors need verified line weights");
    }
    return { id, index, weight };
  });
  const hasChangedLines = actors.some((actor) => actor.weight > 0n);
  actors.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const allocation = allocateWeighted(
    BigInt(totalPoints),
    actors.map((actor) => (hasChangedLines ? actor.weight : 1n)),
  );
  const shares = Array<number>(actorIds.length);
  for (const [index, actor] of actors.entries()) {
    shares[actor.index] = Number(allocation.amounts[index]);
  }
  return shares;
}

/** Preserve the compatibility unit while rounding allocations in whole Points. */
export function shareImplementationScoreThirds(
  totalThirds: number,
  actorIds: readonly string[],
  lineWeights: ReadonlyMap<string, bigint>,
): number[] {
  return shareImplementationPoints(
    scoreThirdsToPoints(totalThirds),
    actorIds,
    lineWeights,
  ).map((points) => {
    const thirds = points / 10;
    if (scoreThirdsToPoints(thirds) !== points)
      throw new TypeError("score share cannot preserve exact whole Points");
    return thirds;
  });
}

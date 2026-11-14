/** A legacy credit-third is ten Points; persisted values use whole Points. */
export function isScoreThirds(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return false;
  const points = Math.round(value * 10);
  return Number.isSafeInteger(points) && points / 10 === value;
}

export function scoreThirdsToPoints(value: number): number {
  if (!isScoreThirds(value))
    throw new TypeError("score thirds must represent nonnegative whole Points");
  return Math.round(value * 10);
}

/** Add in integer Points so decimal compatibility fields cannot drift. */
export function addScoreThirds(left: number, right: number): number {
  const points = scoreThirdsToPoints(left) + scoreThirdsToPoints(right);
  if (!Number.isSafeInteger(points))
    throw new TypeError("combined score exceeds safe integer Points");
  const thirds = points / 10;
  if (scoreThirdsToPoints(thirds) !== points)
    throw new TypeError("combined score cannot preserve exact whole Points");
  return thirds;
}

/** Exact conversion for unbounded historical compatibility strings. */
export function scoreThirdsStringToPoints(value: string): bigint {
  if (typeof value !== "string")
    throw new TypeError("score thirds must be a canonical string");
  const match = /^(0|[1-9][0-9]*)(?:\.([1-9]))?$/u.exec(value);
  if (!match)
    throw new TypeError("score thirds string must represent whole Points");
  return BigInt(match[1]) * 10n + BigInt(match[2] ?? "0");
}

export function pointsToScoreThirdsString(points: bigint): string {
  if (typeof points !== "bigint" || points < 0n)
    throw new TypeError("Points must be a nonnegative integer");
  const thirds = points / 10n;
  const remainder = points % 10n;
  return remainder === 0n ? thirds.toString() : `${thirds}.${remainder}`;
}

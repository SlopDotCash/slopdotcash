export interface MonthlyBaseRow {
  githubUserId: string;
  login: string;
  grossBase: string;
  sourceDigest: string;
}

export interface MonthlyAllocation extends MonthlyBaseRow {
  proposedGrossBase: string;
}

export interface IndexedAllocationChange {
  /** The caller's exact recipient slot, or -1 for an unknown recipient. */
  index: number;
  grossBase: string;
}

export interface AllocationReplacement {
  rows: MonthlyAllocation[];
  /** First unknown recipient in the supplied change order, or -1 on success. */
  unknownAt: number;
}

/** Only the selected gross amount changes; every other field stays intact. */
//@ verify
//@ requires forall(i, 0 <= i && i < changes.length ==> -1 <= changes[i].index && changes[i].index < rows.length)
//@ ensures \result.rows.length == rows.length
//@ ensures -1 <= \result.unknownAt && \result.unknownAt < changes.length
//@ ensures (\result.unknownAt == -1) <==> forall(i, 0 <= i && i < changes.length ==> changes[i].index >= 0)
//@ ensures \result.unknownAt >= 0 ==> changes[\result.unknownAt].index == -1 && forall(i, 0 <= i && i < \result.unknownAt ==> changes[i].index >= 0)
//@ ensures forall(k, 0 <= k && k < rows.length ==> \result.rows[k].githubUserId == rows[k].githubUserId && \result.rows[k].login == rows[k].login && \result.rows[k].sourceDigest == rows[k].sourceDigest && \result.rows[k].proposedGrossBase == rows[k].proposedGrossBase)
//@ ensures forall(k, 0 <= k && k < rows.length ==> \result.rows[k].grossBase == LatestGross(rows[k].grossBase, changes.slice(0, \result.unknownAt < 0 ? changes.length : \result.unknownAt), k))
export function replaceMonthlyAllocations(
  rows: readonly MonthlyAllocation[],
  changes: readonly IndexedAllocationChange[],
): AllocationReplacement {
  const result = rows.slice();
  let i = 0;
  while (i < changes.length) {
    //@ invariant 0 <= i && i <= changes.length
    //@ invariant result.length == rows.length
    //@ invariant forall(j, 0 <= j && j < i ==> changes[j].index >= 0)
    //@ invariant forall(k, 0 <= k && k < rows.length ==> result[k].githubUserId == rows[k].githubUserId && result[k].login == rows[k].login && result[k].sourceDigest == rows[k].sourceDigest && result[k].proposedGrossBase == rows[k].proposedGrossBase)
    //@ invariant forall(k, 0 <= k && k < rows.length ==> result[k].grossBase == LatestGross(rows[k].grossBase, changes.slice(0, i), k))
    const change = changes[i];
    if (change.index < 0) return { rows: result, unknownAt: i };
    result[change.index] = {
      ...result[change.index],
      grossBase: change.grossBase,
    };
    i += 1;
  }
  return { rows: result, unknownAt: -1 };
}

/** Permission refusals precede recipient lookup and every existing-row parse. */
//@ verify
//@ pure
//@ ensures \result == 1 <==> target == actor
//@ ensures \result == 2 <==> target != actor && amount > 0 && excluded
//@ ensures \result == 0 <==> target != actor && (amount <= 0 || !excluded)
export function monthlyChangePolicy(
  target: string,
  actor: string,
  amount: bigint,
  excluded: boolean,
): number {
  if (target === actor) return 1;
  if (amount > 0n && excluded) return 2;
  return 0;
}

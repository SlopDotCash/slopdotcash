//@ backend dafny
// spec/points/census.md, "A live collection spends at most 4,900 GraphQL cost points per rate-limit window, keeps a 100-point reserve and recollects a changed review census once within the same budget"

export const detailedMergedPullRequestsPerMonth = 5;

//@ pure
export function earlierInGroup(groups: readonly number[], count: number, group: number): number {
  //@ requires 0 <= count
  //@ requires count <= groups.length
  //@ ensures \result >= 0
  //@ ensures \result <= count
  //@ decreases count
  if (count === 0) return 0;
  if (groups[count - 1] === group) return earlierInGroup(groups, count - 1, group) + 1;
  return earlierInGroup(groups, count - 1, group);
}

//@ pure
export function detailed(groups: readonly number[], reviewed: readonly boolean[], index: number): boolean {
  //@ requires 0 <= index
  //@ requires index < groups.length
  //@ requires groups.length === reviewed.length
  return reviewed[index] || (groups[index] >= 0 && earlierInGroup(groups, index, groups[index]) < 5);
}

/** @throws {never} */
export function selectDetailed(groups: readonly number[], reviewed: readonly boolean[], groupCount: number): boolean[] {
  //@ requires groupCount >= 0
  //@ requires groups.length === reviewed.length
  //@ requires forall(k, 0 <= k && k < groups.length ==> -1 <= groups[k] && groups[k] < groupCount)
  //@ ensures \result.length === groups.length
  //@ ensures forall(k, 0 <= k && k < groups.length ==> \result[k] === detailed(groups, reviewed, k))
  //@ ensures forall(k, 0 <= k && k < groups.length && reviewed[k] ==> \result[k])
  //@ ensures forall(k, 0 <= k && k < groups.length && \result[k] && !reviewed[k] ==> groups[k] >= 0 && earlierInGroup(groups, k, groups[k]) < 5)
  const counts: number[] = [];
  let group = 0;
  while (group < groupCount) {
    //@ invariant 0 <= group && group <= groupCount
    //@ invariant counts.length === group
    //@ invariant forall(k, 0 <= k && k < group ==> counts[k] === 0)
    //@ decreases groupCount - group
    counts.push(0);
    group = group + 1;
  }
  const selected: boolean[] = [];
  let i = 0;
  while (i < groups.length) {
    //@ invariant 0 <= i && i <= groups.length
    //@ invariant counts.length === groupCount
    //@ invariant selected.length === i
    //@ invariant forall(k, 0 <= k && k < groupCount ==> counts[k] === earlierInGroup(groups, i, k))
    //@ invariant forall(k, 0 <= k && k < i ==> selected[k] === detailed(groups, reviewed, k))
    //@ decreases groups.length - i
    const current = groups[i];
    selected.push(reviewed[i] || (current >= 0 && counts[current] < detailedMergedPullRequestsPerMonth));
    if (current >= 0) counts[current] = counts[current] + 1;
    i = i + 1;
  }
  return selected;
}

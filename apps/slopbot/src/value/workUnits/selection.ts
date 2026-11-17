//@ backend dafny
// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"

export interface AcceptedCommit { sha: string; parentCount: number }

//@ pure
export function stringsContain(values: readonly string[], target: string, count: number): boolean {
  //@ requires 0 <= count && count <= values.length
  //@ ensures \result <==> exists(k, 0 <= k && k < count && values[k] === target)
  //@ decreases count
  if (count === 0) return false;
  return values[count - 1] === target || stringsContain(values, target, count - 1);
}

//@ pure
export function acceptedAt(commits: readonly AcceptedCommit[], resolutions: readonly string[], indirect: boolean, acceptedShas: readonly string[], index: number): boolean {
  //@ requires 0 <= index && index < commits.length
  return (commits[index].parentCount <= 1 || stringsContain(resolutions, commits[index].sha, resolutions.length)) &&
    (!indirect || stringsContain(acceptedShas, commits[index].sha, acceptedShas.length));
}

//@ pure
export function acceptedIndices(commits: readonly AcceptedCommit[], resolutions: readonly string[], indirect: boolean, acceptedShas: readonly string[], count: number): number[] {
  //@ requires 0 <= count && count <= commits.length
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < count)
  //@ ensures forall(i, 0 <= i && i < \result.length ==> forall(j, i < j && j < \result.length ==> \result[i] < \result[j]))
  //@ ensures forall(c, 0 <= c && c < count ==> (acceptedAt(commits, resolutions, indirect, acceptedShas, c) <==> exists(k, 0 <= k && k < \result.length && \result[k] === c)))
  //@ decreases count
  if (count === 0) return [];
  return acceptedAt(commits, resolutions, indirect, acceptedShas, count - 1)
    ? acceptedIndices(commits, resolutions, indirect, acceptedShas, count - 1).concat([count - 1])
    : acceptedIndices(commits, resolutions, indirect, acceptedShas, count - 1);
}

export function containsString(values: readonly string[], target: string): boolean {
  //@ ensures \result === stringsContain(values, target, values.length)
  let i = values.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant stringsContain(values, target, values.length) === stringsContain(values, target, i)
    //@ decreases i
    if (values[i - 1] === target) return true;
    i = i - 1;
  }
  return false;
}

export function selectAcceptedCommitIndices(commits: readonly AcceptedCommit[], resolutions: readonly string[], indirect: boolean, acceptedShas: readonly string[]): number[] {
  //@ ensures \result === acceptedIndices(commits, resolutions, indirect, acceptedShas, commits.length)
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < commits.length)
  //@ ensures forall(i, 0 <= i && i < \result.length ==> forall(j, i < j && j < \result.length ==> \result[i] < \result[j]))
  const result: number[] = [];
  let i = 0;
  while (i < commits.length) {
    //@ invariant 0 <= i && i <= commits.length
    //@ invariant result === acceptedIndices(commits, resolutions, indirect, acceptedShas, i)
    //@ invariant forall(k, 0 <= k && k < result.length ==> 0 <= result[k] && result[k] < i)
    //@ invariant forall(k, 0 <= k && k < result.length ==> forall(j, k < j && j < result.length ==> result[k] < result[j]))
    //@ decreases commits.length - i
    const commit = commits[i];
    if (commit.parentCount <= 1 || containsString(resolutions, commit.sha)) {
      if (!indirect || containsString(acceptedShas, commit.sha)) result.push(i);
    }
    i = i + 1;
  }
  return result;
}

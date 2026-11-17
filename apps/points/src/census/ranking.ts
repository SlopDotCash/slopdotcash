//@ backend dafny
// spec/points/census.md, "Collection starts only for a collected project and never moves its window back"

export interface Reward { committedMinor: string; monthlyCapMinor: string; publishAtRoot: boolean }

export function minorOrder(left: string, right: string): number {
  //@ ensures -1 <= \result && \result <= 1
  //@ ensures left.length > right.length ==> \result === -1
  //@ ensures left.length < right.length ==> \result === 1
  //@ ensures \result === 0 <==> (left.length === right.length && forall(k, 0 <= k && k < left.length ==> left.charCodeAt(k) === right.charCodeAt(k)))
  if (left.length !== right.length) return left.length > right.length ? -1 : 1;
  let i = 0;
  while (i < left.length) {
    //@ invariant 0 <= i && i <= left.length
    //@ invariant left.length === right.length
    //@ invariant forall(k, 0 <= k && k < i ==> left.charCodeAt(k) === right.charCodeAt(k))
    //@ decreases left.length - i
    if (left.charCodeAt(i) !== right.charCodeAt(i)) return left.charCodeAt(i) > right.charCodeAt(i) ? -1 : 1;
    i = i + 1;
  }
  return 0;
}

export function rewardOrder(left: Reward, right: Reward): number {
  //@ ensures -1 <= \result && \result <= 1
  //@ ensures left.committedMinor.length > right.committedMinor.length ==> \result === -1
  //@ ensures left.committedMinor.length < right.committedMinor.length ==> \result === 1
  //@ ensures \result === 0 ==> left.publishAtRoot === right.publishAtRoot && left.committedMinor.length === right.committedMinor.length && left.monthlyCapMinor.length === right.monthlyCapMinor.length
  const committed = minorOrder(left.committedMinor, right.committedMinor);
  if (committed !== 0) return committed;
  const cap = minorOrder(left.monthlyCapMinor, right.monthlyCapMinor);
  if (cap !== 0) return cap;
  if (left.publishAtRoot === right.publishAtRoot) return 0;
  return left.publishAtRoot ? -1 : 1;
}

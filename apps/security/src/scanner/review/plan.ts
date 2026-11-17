//@ backend dafny
// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"

/** @throws {never} */
export function fittedAliasCount(base: number, aliasBytes: number[], limit: number): number {
  //@ requires base >= 0 && limit >= 0
  //@ ensures 0 <= \result && \result <= aliasBytes.length
  let size = base;
  let fitted = 0;
  while (fitted < aliasBytes.length) {
    //@ invariant 0 <= fitted && fitted <= aliasBytes.length
    //@ decreases aliasBytes.length - fitted
    const comma = fitted > 0 ? 1 : 0;
    size = size + aliasBytes[fitted] + comma;
    if (size > limit) return fitted;
    fitted = fitted + 1;
  }
  return fitted;
}

/** @throws {never} */
export function batchEnds(bytes: number[], standalone: boolean[], overhead: number, limit: number, maximumItems: number): number[] {
  //@ requires bytes.length === standalone.length && overhead >= 0 && limit >= 0 && maximumItems > 0
  //@ ensures (\result.length === 0) <==> (bytes.length === 0)
  //@ ensures \result.length > 0 ==> \result[\result.length - 1] === bytes.length
  //@ ensures \result.length > 0 ==> 0 < \result[0] && \result[0] <= maximumItems
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 < \result[i] && \result[i] <= bytes.length)
  //@ ensures forall(i, 0 < i && i < \result.length ==> \result[i - 1] < \result[i] && \result[i] - \result[i - 1] <= maximumItems)
  const ends: number[] = [];
  let start = 0;
  let i = 0;
  let size = overhead;
  while (i < bytes.length) {
    //@ invariant 0 <= start && start <= i && i <= bytes.length
    //@ invariant i - start <= maximumItems
    //@ invariant (ends.length === 0) <==> (start === 0)
    //@ invariant ends.length > 0 ==> ends[ends.length - 1] === start
    //@ invariant ends.length > 0 ==> 0 < ends[0] && ends[0] <= maximumItems
    //@ invariant forall(k, 0 <= k && k < ends.length ==> 0 < ends[k] && ends[k] <= start)
    //@ invariant forall(k, 0 < k && k < ends.length ==> ends[k - 1] < ends[k] && ends[k] - ends[k - 1] <= maximumItems)
    //@ decreases bytes.length - i
    if (standalone[i]) {
      if (start < i) ends.push(i);
      ends.push(i + 1);
      i = i + 1;
      start = i;
      size = overhead;
    } else {
      if (start < i && (size + bytes[i] > limit || i - start >= maximumItems)) {
        ends.push(i);
        start = i;
        size = overhead;
      }
      size = size + bytes[i];
      i = i + 1;
    }
  }
  if (start < i) ends.push(i);
  return ends;
}

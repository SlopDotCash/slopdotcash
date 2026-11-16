/** Bounded accumulation and stable maximum selection over supplied values. */

/** Cap each addition so intermediate score totals remain exact integers. */
//@ verify
//@ requires 0 <= limit && limit <= 9007199254740991
//@ requires 0 <= minimum && minimum <= 9007199254740991
//@ requires forall(i, 0 <= i && i < values.length ==> 0 <= values[i] && values[i] <= 9007199254740991)
//@ ensures \result == (ValueSum(values) < limit ? (ValueSum(values) < minimum ? minimum : ValueSum(values)) : (limit < minimum ? minimum : limit))
//@ ensures minimum <= \result && \result <= (limit < minimum ? minimum : limit)
export function cappedTotal(
  values: number[],
  limit: number,
  minimum: number,
): number {
  let total = 0;
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant 0 <= total && total <= limit
    //@ invariant total == (ValueSum(values.slice(0, i)) < limit ? ValueSum(values.slice(0, i)) : limit)
    const remaining = limit - total;
    if (values[i] >= remaining) total = limit;
    else total += values[i];
    i += 1;
  }
  return Math.max(minimum, total);
}

/** Equal maxima retain the first input, as a stable descending sort does. */
//@ verify
//@ requires values.length > 0
//@ ensures 0 <= \result && \result < values.length
//@ ensures forall(i, 0 <= i && i < values.length ==> values[i] <= values[\result])
//@ ensures forall(i, 0 <= i && i < \result ==> values[i] < values[\result])
export function firstMaximumIndex(values: number[]): number {
  let best = 0;
  let i = 1;
  while (i < values.length) {
    //@ invariant 1 <= i && i <= values.length
    //@ invariant 0 <= best && best < i
    //@ invariant forall(k, 0 <= k && k < i ==> values[k] <= values[best])
    //@ invariant forall(k, 0 <= k && k < best ==> values[k] < values[best])
    if (values[i] > values[best]) best = i;
    i += 1;
  }
  return best;
}

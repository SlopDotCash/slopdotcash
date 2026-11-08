/** Exact collection arithmetic; input order supplies the deterministic tie ordinal. */
/** Exact sum with no collection-size or amount bound. */
//@ verify
//@ ensures \result == Sum(values)
//@ ensures forall(i, 0 <= i && i < values.length ==> values[i] >= 0) ==> \result >= 0
export function sumAmounts(values: bigint[]): bigint {
  let total = 0n;
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant total == Sum(values.slice(0, i))
    total += values[i];
    i += 1;
  }
  return total;
}

export interface ShareRemainder {
  index: number;
  remainder: bigint;
}

//@ verify
//@ pure
//@ ensures \result <==> left.remainder > right.remainder || (left.remainder === right.remainder && left.index <= right.index)
export function remainderBefore(
  left: ShareRemainder,
  right: ShareRemainder,
): boolean {
  return (
    left.remainder > right.remainder ||
    (left.remainder === right.remainder && left.index <= right.index)
  );
}

//@ verify
//@ decreases values.length
//@ ensures \result.length == values.length
//@ ensures Bag(\result) == Bag(values)
//@ ensures Ordered(\result)
//@ ensures forall(k, CountIndex(\result, k) == CountIndex(values, k))
export function sortRemainders(values: ShareRemainder[]): ShareRemainder[] {
  if (values.length < 2) return values.slice();
  const middle = Math.floor(values.length / 2);
  const left = sortRemainders(values.slice(0, middle));
  const right = sortRemainders(values.slice(middle));
  const result: ShareRemainder[] = [];
  let i = 0;
  let j = 0;
  while (i + j < left.length + right.length) {
    //@ invariant 0 <= i && i <= left.length && 0 <= j && j <= right.length
    //@ invariant result.length == i + j
    //@ invariant Ordered(result)
    //@ invariant Bag(result) + Bag(left.slice(i)) + Bag(right.slice(j)) == Bag(values)
    //@ invariant forall(k, CountIndex(result, k) + CountIndex(left.slice(i), k) + CountIndex(right.slice(j), k) == CountIndex(values, k))
    //@ invariant forall(k, 0 <= k && k < result.length ==> forall(l, i <= l && l < left.length ==> remainderBefore(result[k], left[l])))
    //@ invariant forall(k, 0 <= k && k < result.length ==> forall(r, j <= r && r < right.length ==> remainderBefore(result[k], right[r])))
    let takeLeft = false;
    if (j === right.length) takeLeft = true;
    else if (i < left.length) takeLeft = remainderBefore(left[i], right[j]);
    if (takeLeft) {
      result.push(left[i]);
      i += 1;
    } else {
      result.push(right[j]);
      j += 1;
    }
  }
  return result;
}

export interface WeightedAllocation {
  amounts: bigint[];
  order: ShareRemainder[];
}

//@ verify
//@ requires total >= 0
//@ requires forall(i, 0 <= i && i < weights.length ==> weights[i] >= 0)
//@ ensures \result.amounts.length == weights.length
//@ ensures Sum(\result.amounts) == (Sum(weights) > 0 ? total : 0)
//@ ensures forall(i, 0 <= i && i < weights.length ==> \result.amounts[i] >= 0 && \result.amounts[i] <= total)
//@ ensures Sum(weights) > 0 ==> forall(i, 0 <= i && i < weights.length ==> total * weights[i] / Sum(weights) <= \result.amounts[i] && \result.amounts[i] <= total * weights[i] / Sum(weights) + 1)
//@ ensures Sum(weights) > 0 ==> forall(a, 0 <= a && a < weights.length ==> forall(b, 0 <= b && b < weights.length && \result.amounts[a] > total * weights[a] / Sum(weights) && \result.amounts[b] == total * weights[b] / Sum(weights) ==> BeforeStrict(total * weights[a] % Sum(weights), a, total * weights[b] % Sum(weights), b)))
//@ ensures \result.order.length == weights.length
//@ ensures Ordered(\result.order)
//@ ensures forall(k, 0 <= k && k < weights.length ==> CountIndex(\result.order, k) == 1)
//@ ensures forall(k, 0 <= k && k < \result.order.length ==> 0 <= \result.order[k].index && \result.order[k].index < weights.length && \result.order[k].remainder == (Sum(weights) > 0 ? total * weights[\result.order[k].index] % Sum(weights) : 0))
export function allocateWeighted(
  total: bigint,
  weights: bigint[],
): WeightedAllocation {
  const denominator = sumAmounts(weights);
  const amounts: bigint[] = [];
  const candidates: ShareRemainder[] = [];
  let allocated = 0n;
  let i = 0;
  if (denominator === 0n) {
    while (i < weights.length) {
      //@ invariant 0 <= i && i <= weights.length
      //@ invariant amounts.length == i && candidates.length == i
      //@ invariant Sum(amounts) == 0
      //@ invariant forall(k, 0 <= k && k < i ==> amounts[k] == 0)
      //@ invariant forall(k, 0 <= k && k < i ==> candidates[k].index == k && candidates[k].remainder == 0)
      //@ invariant Ordered(candidates)
      amounts.push(0n);
      candidates.push({ index: i, remainder: 0n });
      i += 1;
    }
    return { amounts, order: candidates };
  }
  while (i < weights.length) {
    //@ invariant 0 <= i && i <= weights.length
    //@ invariant amounts.length == i && candidates.length == i
    //@ invariant Sum(amounts) == allocated
    //@ invariant forall(k, 0 <= k && k < i ==> amounts[k] >= 0)
    //@ invariant forall(k, 0 <= k && k < i ==> amounts[k] == total * weights[k] / denominator)
    //@ invariant forall(k, 0 <= k && k < i ==> candidates[k].index == k && candidates[k].remainder == total * weights[k] % denominator)
    //@ invariant forall(k, 0 <= k && k < i ==> 0 <= candidates[k].remainder && candidates[k].remainder < denominator)
    //@ invariant forall(k, 0 <= k && k < i ==> amounts[k] * denominator + candidates[k].remainder == total * weights[k])
    const numerator = total * weights[i];
    const amount = numerator / denominator;
    amounts.push(amount);
    candidates.push({ index: i, remainder: numerator % denominator });
    allocated += amount;
    i += 1;
  }
  const order = sortRemainders(candidates);
  let remaining = total - allocated;
  //@ ghost let initialRemaining = remaining
  let j = 0;
  while (remaining > 0n) {
    //@ invariant remaining >= 0
    //@ invariant amounts.length == weights.length && order.length == weights.length
    //@ invariant initialRemaining < weights.length && remaining + j == initialRemaining
    //@ invariant forall(k, 0 <= k && k < amounts.length ==> amounts[k] >= 0)
    //@ invariant 0 <= j && j <= order.length
    //@ invariant Sum(amounts) + remaining == total
    //@ invariant forall(k, 0 <= k && k < weights.length ==> amounts[k] == total * weights[k] / denominator + CountIndex(order.slice(0, j), k))
    const index = order[j].index;
    amounts[index] = amounts[index] + 1n;
    remaining -= 1n;
    j += 1;
  }
  return { amounts, order };
}

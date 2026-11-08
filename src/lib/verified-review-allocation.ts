/** PRD section 7: up to the first five distinct qualifying reviewers. */
export const MAX_CREDITED_REVIEWERS = 5 as const;

/** Exact sum for the positive integer review weights accepted by the caller. */
//@ verify
//@ requires values.length <= MAX_CREDITED_REVIEWERS
//@ requires forall(i, 0 <= i && i < values.length ==> values[i] > 0)
//@ ensures \result == Sum(values)
//@ ensures \result >= values.length
function sumWeights(values: bigint[]): bigint {
  let total = 0n;
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant total == Sum(values.slice(0, i))
    //@ invariant total >= i
    total += values[i];
    i += 1;
  }
  return total;
}

/** Largest remainder for the existing maximum of five credited reviewers. */
//@ verify
//@ requires total >= 0 && weights.length > 0 && weights.length <= MAX_CREDITED_REVIEWERS
//@ requires forall(i, 0 <= i && i < weights.length ==> weights[i] > 0)
//@ ensures Sum(weights) > 0
//@ ensures \result.length == weights.length
//@ ensures Sum(\result) == total
//@ ensures forall(i, 0 <= i && i < weights.length ==> \result[i] >= 0 && \result[i] <= total)
//@ ensures forall(i, 0 <= i && i < weights.length ==> total * weights[i] / Sum(weights) <= \result[i] && \result[i] <= total * weights[i] / Sum(weights) + 1)
//@ ensures forall(a, 0 <= a && a < weights.length ==> forall(b, 0 <= b && b < weights.length && \result[a] > total * weights[a] / Sum(weights) && \result[b] == total * weights[b] / Sum(weights) ==> Before(total * weights[a] % Sum(weights), a, total * weights[b] % Sum(weights), b)))
export function allocateReviewShares(
  total: bigint,
  weights: bigint[],
): bigint[] {
  const denominator = sumWeights(weights);
  const amounts: bigint[] = [];
  const remainders: bigint[] = [];
  let allocated = 0n;
  let i = 0;
  while (i < weights.length) {
    //@ invariant 0 <= i && i <= weights.length
    //@ invariant amounts.length == i && remainders.length == i
    //@ invariant allocated == Sum(amounts)
    //@ invariant forall(k, 0 <= k && k < amounts.length ==> amounts[k] >= 0)
    //@ invariant forall(k, 0 <= k && k < i ==> amounts[k] == total * weights[k] / denominator)
    //@ invariant forall(k, 0 <= k && k < i ==> 0 <= remainders[k] && remainders[k] < denominator)
    //@ invariant forall(k, 0 <= k && k < i ==> remainders[k] == total * weights[k] % denominator)
    //@ invariant forall(k, 0 <= k && k < i ==> amounts[k] * denominator + remainders[k] == total * weights[k])
    const numerator = total * weights[i];
    const amount = numerator / denominator;
    amounts.push(amount);
    remainders.push(numerator % denominator);
    allocated += amount;
    i += 1;
  }
  let remaining = total - allocated;
  //@ ghost let initialRemaining = remaining
  while (remaining > 0n) {
    //@ invariant amounts.length == weights.length && remainders.length == weights.length
    //@ invariant 0 <= remaining && remaining <= initialRemaining && initialRemaining < weights.length
    //@ invariant Sum(amounts) + remaining == total
    //@ invariant forall(k, 0 <= k && k < amounts.length ==> amounts[k] >= 0)
    //@ invariant CountMarked(remainders) == initialRemaining - remaining
    //@ invariant forall(k, 0 <= k && k < weights.length ==> remainders[k] >= -1)
    //@ invariant forall(k, 0 <= k && k < weights.length && remainders[k] >= 0 ==> remainders[k] == total * weights[k] % denominator)
    //@ invariant forall(a, 0 <= a && a < weights.length && remainders[a] == -1 ==> forall(b, 0 <= b && b < weights.length && remainders[b] >= 0 ==> Before(total * weights[a] % denominator, a, total * weights[b] % denominator, b)))
    //@ invariant forall(k, 0 <= k && k < weights.length ==> amounts[k] == total * weights[k] / denominator + (remainders[k] == -1 ? 1 : 0))
    let best = -1;
    let j = 0;
    while (j < remainders.length) {
      //@ invariant 0 <= j && j <= remainders.length
      //@ invariant -1 <= best && best < j
      //@ invariant best >= 0 ==> remainders[best] >= 0
      //@ invariant best >= 0 ==> forall(k, 0 <= k && k < j && remainders[k] == remainders[best] ==> best <= k)
      //@ invariant best == -1 ==> forall(k, 0 <= k && k < j ==> remainders[k] == -1)
      //@ invariant best >= 0 ==> forall(k, 0 <= k && k < j && remainders[k] >= 0 ==> remainders[k] <= remainders[best])
      if (
        remainders[j] >= 0n &&
        (best < 0 || remainders[j] > remainders[best])
      ) {
        best = j;
      }
      j += 1;
    }
    //@ assert best >= 0
    amounts[best] = amounts[best] + 1n;
    remainders[best] = -1n;
    remaining -= 1n;
  }
  return amounts;
}

/** Integer accepted-work scoring kernels (PRD section 5). */

/**
 * Splits integer score thirds evenly across actors, earlier actors taking the
 * remainder. With a one-third minimum, a total below the actor count gives
 * every actor one third instead. ThirdsSum is the proof's sequence sum.
 */
//@ verify
//@ requires actors >= 1 && total >= minimumPerActor && (minimumPerActor == 0 || minimumPerActor == 1)
//@ ensures \result.length == actors
//@ ensures total >= actors || minimumPerActor == 0 ==> forall(i, 0 <= i && i < actors ==> \result[i] == Math.floor(total / actors) + (i < total % actors ? 1 : 0))
//@ ensures total >= actors || minimumPerActor == 0 ==> ThirdsSum(\result) == total
//@ ensures total < actors && minimumPerActor == 1 ==> forall(i, 0 <= i && i < actors ==> \result[i] == 1)
//@ ensures total < actors && minimumPerActor == 1 ==> ThirdsSum(\result) == actors
//@ ensures forall(i, 0 <= i && i < actors ==> \result[i] >= minimumPerActor)
//@ ensures forall(i, 0 <= i && i < actors ==> forall(j, i < j && j < actors ==> \result[i] >= \result[j] && \result[i] - \result[j] <= 1))
export function shareScoreThirds(
  total: number,
  actors: number,
  minimumPerActor: number,
): number[] {
  const base = Math.floor(total / actors);
  const extra = total % actors;
  const shares: number[] = [];
  let i = 0;
  while (i < actors) {
    //@ invariant 0 <= i && i <= actors && shares.length == i
    //@ invariant base == 0 && minimumPerActor == 1 ==> forall(k, 0 <= k && k < i ==> shares[k] == 1)
    //@ invariant base == 0 && minimumPerActor == 1 ==> ThirdsSum(shares) == i
    //@ invariant !(base == 0 && minimumPerActor == 1) ==> forall(k, 0 <= k && k < i ==> shares[k] == base + (k < extra ? 1 : 0))
    //@ invariant !(base == 0 && minimumPerActor == 1) ==> ThirdsSum(shares) == base * i + (i < extra ? i : extra)
    shares.push(
      base === 0 && minimumPerActor === 1 ? 1 : base + (i < extra ? 1 : 0),
    );
    i += 1;
  }
  return shares;
}

/**
 * Accepted-merge credit for the n-th merge of a project and UTC month: the
 * least k from 1 to 10 with k * k * n >= 100, which equals
 * max(1, ceil(10 / sqrt(n))) without floating point.
 */
//@ verify
//@ requires ordinal >= 1
//@ ensures 1 <= \result && \result <= 10
//@ ensures \result * \result * ordinal >= 100
//@ ensures \result == 1 || (\result - 1) * (\result - 1) * ordinal < 100
export function mergedPullRequestCredit(ordinal: number): number {
  let k = 1;
  while (k < 10 && k * k * ordinal < 100) {
    //@ invariant 1 <= k && k <= 10
    //@ invariant k == 1 || (k - 1) * (k - 1) * ordinal < 100
    k = k + 1;
  }
  return k;
}

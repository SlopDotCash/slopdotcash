//@ backend dafny
// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"; spec/security/admission.md, "The primary review decides and an ambiguous or high-risk finding needs the specialist"

/** @throws {never} */
export function prefixSums(values: number[]): number[] {
  //@ ensures \result.length === values.length + 1 && \result[0] === 0
  //@ ensures forall(i, 0 <= i && i < values.length ==> \result[i + 1] === \result[i] + values[i])
  const sums: number[] = [0];
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant sums.length === i + 1 && sums[0] === 0
    //@ invariant forall(k, 0 <= k && k < i ==> sums[k + 1] === sums[k] + values[k])
    //@ decreases values.length - i
    sums.push(sums[i] + values[i]);
    i = i + 1;
  }
  return sums;
}

/** @throws {never} */
export function fittedAliasCount(base: number, aliasPrefix: number[], limit: number): number {
  //@ requires aliasPrefix.length > 0
  //@ ensures 0 <= \result && \result < aliasPrefix.length
  //@ ensures forall(n, 1 <= n && n <= \result ==> base + aliasPrefix[n] + n - 1 <= limit)
  //@ ensures \result + 1 < aliasPrefix.length ==> base + aliasPrefix[\result + 1] + \result > limit
  let fitted = 0;
  while (fitted + 1 < aliasPrefix.length) {
    //@ invariant 0 <= fitted && fitted < aliasPrefix.length
    //@ invariant forall(n, 1 <= n && n <= fitted ==> base + aliasPrefix[n] + n - 1 <= limit)
    //@ decreases aliasPrefix.length - fitted
    if (base + aliasPrefix[fitted + 1] + fitted > limit) {
      return fitted;
    }
    fitted = fitted + 1;
  }
  return fitted;
}

/** @throws {never} */
export function spanStarts(prefix: number[], standalone: boolean[], overhead: number, limit: number, maximumItems: number): number[] {
  //@ requires prefix.length === standalone.length + 1 && maximumItems > 0
  //@ ensures \result.length === standalone.length
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] <= i && i - \result[i] < maximumItems)
  //@ ensures \result.length > 0 ==> \result[0] === 0
  //@ ensures forall(i, 0 < i && i < \result.length ==> \result[i] === i || \result[i] === \result[i - 1])
  //@ ensures forall(i, 0 <= i && i < \result.length && 0 <= \result[i] && \result[i] < i ==> overhead + prefix[i + 1] - prefix[\result[i]] <= limit)
  //@ ensures forall(i, 0 <= i && i < \result.length && standalone[i] ==> \result[i] === i)
  //@ ensures forall(i, 0 < i && i < \result.length && standalone[i - 1] ==> \result[i] === i)
  const starts: number[] = [];
  let start = 0;
  let i = 0;
  while (i < standalone.length) {
    //@ invariant 0 <= start && start <= i && i <= standalone.length
    //@ invariant starts.length === i
    //@ invariant forall(k, 0 <= k && k < i ==> 0 <= starts[k] && starts[k] <= k && k - starts[k] < maximumItems)
    //@ invariant i > 0 ==> starts[0] === 0
    //@ invariant forall(k, 0 < k && k < i ==> starts[k] === k || starts[k] === starts[k - 1])
    //@ invariant forall(k, 0 <= k && k < i && 0 <= starts[k] && starts[k] < k ==> overhead + prefix[k + 1] - prefix[starts[k]] <= limit)
    //@ invariant forall(k, 0 <= k && k < i && standalone[k] ==> starts[k] === k)
    //@ invariant forall(k, 0 < k && k < i && standalone[k - 1] ==> starts[k] === k)
    //@ invariant forall(k, start <= k && k < i ==> starts[k] === start)
    //@ invariant i > 0 && standalone[i - 1] ==> start === i
    //@ decreases standalone.length - i
    if (standalone[i] || (start < i && (overhead + prefix[i + 1] - prefix[start] > limit || i - start >= maximumItems))) {
      start = i;
    }
    starts.push(start);
    i = i + 1;
    if (standalone[i - 1]) {
      start = i;
    }
  }
  return starts;
}

/** @throws {never} */
export function worstRank(ranks: number[]): number {
  //@ requires ranks.length > 0
  //@ ensures forall(i, 0 <= i && i < ranks.length ==> ranks[i] <= \result)
  //@ ensures exists(i, 0 <= i && i < ranks.length && ranks[i] === \result)
  let worst = ranks[0];
  let i = 1;
  while (i < ranks.length) {
    //@ invariant 1 <= i && i <= ranks.length
    //@ invariant forall(k, 0 <= k && k < i ==> ranks[k] <= worst)
    //@ invariant exists(k, 0 <= k && k < i && ranks[k] === worst)
    //@ decreases ranks.length - i
    if (ranks[i] > worst) {
      worst = ranks[i];
    }
    i = i + 1;
  }
  return worst;
}

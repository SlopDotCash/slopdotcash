/** Exact accounting across indexed actor/project/month buckets. */
export interface BucketAmount {
  bucket: number;
  amount: bigint;
}

/** Every signed entry contributes once to its own bucket only. */
//@ verify
//@ requires count >= 0
//@ requires forall(i, 0 <= i && i < entries.length ==> 0 <= entries[i].bucket && entries[i].bucket < count)
//@ ensures \result.length == count
//@ ensures forall(b, 0 <= b && b < count ==> \result[b] == BucketTotal(entries, b))
//@ ensures forall(i, 0 <= i && i < entries.length ==> entries[i].amount >= 0) ==> forall(b, 0 <= b && b < count ==> \result[b] >= 0)
export function sumBuckets(count: number, entries: BucketAmount[]): bigint[] {
  const totals: bigint[] = [];
  let b = 0;
  while (b < count) {
    //@ invariant 0 <= b && b <= count
    //@ invariant totals.length == b
    //@ invariant forall(k, 0 <= k && k < b ==> totals[k] == 0)
    totals.push(0n);
    b += 1;
  }
  let i = 0;
  while (i < entries.length) {
    //@ invariant 0 <= i && i <= entries.length
    //@ invariant totals.length == count
    //@ invariant forall(k, 0 <= k && k < count ==> totals[k] == BucketTotal(entries.slice(0, i), k))
    //@ invariant forall(k, 0 <= k && k < entries.length ==> entries[k].amount >= 0) ==> forall(k, 0 <= k && k < count ==> totals[k] >= 0)
    const entry = entries[i];
    totals[entry.bucket] = totals[entry.bucket] + entry.amount;
    i += 1;
  }
  return totals;
}

export interface BucketConsumption {
  remaining: bigint[];
  applied: bigint[];
}

/** Requests consume only their bucket, in the caller's existing order. */
//@ verify
//@ requires forall(b, 0 <= b && b < initial.length ==> initial[b] >= 0)
//@ requires forall(i, 0 <= i && i < requests.length ==> 0 <= requests[i].bucket && requests[i].bucket < initial.length && requests[i].amount >= 0)
//@ ensures \result.remaining.length == initial.length && \result.applied.length == requests.length
//@ ensures forall(b, 0 <= b && b < initial.length ==> \result.remaining[b] >= 0 && \result.remaining[b] + AppliedTotal(requests, \result.applied, b) == initial[b])
//@ ensures forall(i, 0 <= i && i < requests.length ==> 0 <= \result.applied[i] && \result.applied[i] <= requests[i].amount)
//@ ensures forall(i, 0 <= i && i < requests.length ==> \result.applied[i] == Minimum(requests[i].amount, initial[requests[i].bucket] - AppliedTotal(requests.slice(0, i), \result.applied.slice(0, i), requests[i].bucket)))
export function consumeBuckets(
  initial: bigint[],
  requests: BucketAmount[],
): BucketConsumption {
  const remaining = initial.slice();
  const applied: bigint[] = [];
  let i = 0;
  while (i < requests.length) {
    //@ invariant 0 <= i && i <= requests.length
    //@ invariant remaining.length == initial.length && applied.length == i
    //@ invariant forall(b, 0 <= b && b < initial.length ==> remaining[b] >= 0 && remaining[b] + AppliedTotal(requests.slice(0, i), applied, b) == initial[b])
    //@ invariant forall(k, 0 <= k && k < i ==> 0 <= applied[k] && applied[k] <= requests[k].amount)
    //@ invariant forall(k, 0 <= k && k < i ==> applied[k] == Minimum(requests[k].amount, initial[requests[k].bucket] - AppliedTotal(requests.slice(0, k), applied.slice(0, k), requests[k].bucket)))
    const request = requests[i];
    const available = remaining[request.bucket];
    const amount = request.amount < available ? request.amount : available;
    remaining[request.bucket] = available - amount;
    applied.push(amount);
    i += 1;
  }
  return { remaining, applied };
}

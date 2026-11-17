//@ backend dafny
// spec/points/penalties.md, "Standing is the month's accepted-work credits minus active debits, never below zero, whatever the order"; spec/points/penalties.md, "Accepted-work credits are keyed by author, project and UTC month"

export interface BucketAmount {
  bucket: number;
  amount: bigint;
}

export interface BucketConsumption {
  remaining: bigint[];
  applied: bigint[];
}

//@ pure
export function bucketTotal(entries: BucketAmount[], bucket: number, count: number): bigint {
  //@ requires 0 <= count && count <= entries.length
  //@ decreases count
  if (count === 0) return 0n;
  const before = bucketTotal(entries, bucket, count - 1);
  return entries[count - 1].bucket === bucket ? before + entries[count - 1].amount : before;
}

//@ pure
export function minimum(left: bigint, right: bigint): bigint {
  //@ ensures \result <= left && \result <= right
  //@ ensures \result == left || \result == right
  return left < right ? left : right;
}

//@ pure
export function remainingAfter(initial: bigint[], requests: BucketAmount[], bucket: number, count: number): bigint {
  //@ requires 0 <= bucket && bucket < initial.length
  //@ requires 0 <= count && count <= requests.length
  //@ decreases count
  if (count === 0) return initial[bucket];
  const before = remainingAfter(initial, requests, bucket, count - 1);
  return requests[count - 1].bucket === bucket ? before - minimum(requests[count - 1].amount, before) : before;
}

//@ pure
export function appliedAt(initial: bigint[], requests: BucketAmount[], index: number): bigint {
  //@ requires 0 <= index && index < requests.length
  //@ requires 0 <= requests[index].bucket && requests[index].bucket < initial.length
  return minimum(requests[index].amount, remainingAfter(initial, requests, requests[index].bucket, index));
}

/** @throws {never} */
export function sumBuckets(count: number, entries: BucketAmount[]): bigint[] {
  //@ requires count >= 0
  //@ requires forall(i, 0 <= i && i < entries.length ==> 0 <= entries[i].bucket && entries[i].bucket < count)
  //@ ensures \result.length == count
  //@ ensures forall(b, 0 <= b && b < count ==> \result[b] == bucketTotal(entries, b, entries.length))
  //@ ensures forall(i, 0 <= i && i < entries.length ==> entries[i].amount >= 0) ==> forall(b, 0 <= b && b < count ==> \result[b] >= 0)
  const totals: bigint[] = [];
  let b = 0;
  while (b < count) {
    //@ invariant 0 <= b && b <= count
    //@ invariant totals.length == b
    //@ invariant forall(k, 0 <= k && k < b ==> totals[k] == 0)
    totals.push(0n);
    b = b + 1;
  }
  let i = 0;
  while (i < entries.length) {
    //@ invariant 0 <= i && i <= entries.length
    //@ invariant totals.length == count
    //@ invariant forall(k, 0 <= k && k < count ==> totals[k] == bucketTotal(entries, k, i))
    //@ invariant forall(k, 0 <= k && k < entries.length ==> entries[k].amount >= 0) ==> forall(k, 0 <= k && k < count ==> totals[k] >= 0)
    const entry = entries[i];
    totals[entry.bucket] = totals[entry.bucket] + entry.amount;
    i = i + 1;
  }
  return totals;
}

/** @throws {never} */
export function consumeBuckets(initial: bigint[], requests: BucketAmount[]): BucketConsumption {
  //@ requires forall(b, 0 <= b && b < initial.length ==> initial[b] >= 0)
  //@ requires forall(i, 0 <= i && i < requests.length ==> 0 <= requests[i].bucket && requests[i].bucket < initial.length && requests[i].amount >= 0)
  //@ ensures \result.remaining.length == initial.length && \result.applied.length == requests.length
  //@ ensures forall(b, 0 <= b && b < initial.length ==> \result.remaining[b] >= 0 && \result.remaining[b] <= initial[b] && \result.remaining[b] == remainingAfter(initial, requests, b, requests.length))
  //@ ensures forall(i, 0 <= i && i < requests.length ==> 0 <= \result.applied[i] && \result.applied[i] <= requests[i].amount && \result.applied[i] == appliedAt(initial, requests, i))
  const remaining = initial.slice();
  const applied: bigint[] = [];
  let i = 0;
  while (i < requests.length) {
    //@ invariant 0 <= i && i <= requests.length
    //@ invariant remaining.length == initial.length && applied.length == i
    //@ invariant forall(b, 0 <= b && b < initial.length ==> remaining[b] >= 0 && remaining[b] <= initial[b] && remaining[b] == remainingAfter(initial, requests, b, i))
    //@ invariant forall(k, 0 <= k && k < i ==> 0 <= applied[k] && applied[k] <= requests[k].amount && applied[k] == appliedAt(initial, requests, k))
    const request = requests[i];
    const amount = minimum(request.amount, remaining[request.bucket]);
    remaining[request.bucket] = remaining[request.bucket] - amount;
    applied.push(amount);
    i = i + 1;
  }
  return { remaining, applied };
}

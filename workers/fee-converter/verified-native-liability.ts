export type NativeSettlementDay =
  | { kind: "undated" }
  | { kind: "dated"; day: string };

/** Parsed journal rows; abandoned rows deliberately carry no parsed amount. */
export type NativeLiabilityEntry =
  | { kind: "abandoned" }
  | { kind: "actual"; settlement: NativeSettlementDay; amount: bigint }
  | { kind: "unsettled"; bucket: number; maximum: bigint };

/** Today's settled fees plus one largest unresolved ceiling per wallet/nonce. */
//@ verify
//@ requires bucketCount >= 0
//@ requires forall(i, 0 <= i && i < entries.length && entries[i].kind == "unsettled" ==> 0 <= entries[i].bucket && entries[i].bucket < bucketCount && entries[i].maximum >= 0)
//@ requires forall(i, 0 <= i && i < entries.length && entries[i].kind == "actual" ==> entries[i].amount >= 0)
//@ ensures \result == RecordedSpend(entries, day) + PendingTotal(entries, bucketCount)
//@ ensures \result >= 0
export function nativeDailyLiability(
  bucketCount: number,
  entries: NativeLiabilityEntry[],
  day: string,
): bigint {
  const maxima: bigint[] = [];
  let b = 0;
  while (b < bucketCount) {
    //@ invariant 0 <= b && b <= bucketCount
    //@ invariant maxima.length == b
    //@ invariant forall(k, 0 <= k && k < b ==> maxima[k] == 0)
    maxima.push(0n);
    b += 1;
  }
  let settled = 0n;
  let i = 0;
  while (i < entries.length) {
    //@ invariant 0 <= i && i <= entries.length
    //@ invariant maxima.length == bucketCount
    //@ invariant settled == RecordedSpend(entries.slice(0, i), day)
    //@ invariant settled >= 0
    //@ invariant forall(k, 0 <= k && k < bucketCount ==> maxima[k] == PendingMaximum(entries.slice(0, i), k) && maxima[k] >= 0)
    const entry = entries[i];
    if (
      entry.kind === "actual" &&
      entry.settlement.kind === "dated" &&
      entry.settlement.day === day
    )
      settled += entry.amount;
    else if (entry.kind === "unsettled" && maxima[entry.bucket] < entry.maximum)
      maxima[entry.bucket] = entry.maximum;
    i += 1;
  }
  let total = settled;
  b = 0;
  while (b < bucketCount) {
    //@ invariant 0 <= b && b <= bucketCount
    //@ invariant settled == RecordedSpend(entries, day)
    //@ invariant total == settled + PendingTotal(entries, b)
    //@ invariant total >= 0
    //@ invariant maxima.length == bucketCount
    //@ invariant forall(k, 0 <= k && k < bucketCount ==> maxima[k] == PendingMaximum(entries, k) && maxima[k] >= 0)
    total += maxima[b];
    b += 1;
  }
  return total;
}

//@ backend dafny
// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/fees/conversion.md, "A token is converted from the wallet's observed balance; native fees only from finalized receipts, and gas top-ups never are"

export type NativeSettlementDay =
  | { kind: "undated" }
  | { kind: "dated"; day: string };

export type NativeLiabilityEntry =
  | { kind: "abandoned" }
  | { kind: "actual"; settlement: NativeSettlementDay; amount: bigint }
  | { kind: "unsettled"; bucket: number; maximum: bigint };

export type NativeFeeEarning =
  | { kind: "direct"; recipient: string; amount: bigint; at: string }
  | { kind: "claim"; amount: bigint; at: string }
  | { kind: "conversion"; amount: bigint };

export type NativeFeeReceipt =
  | { kind: "absent" }
  | { kind: "first"; at: string };

export interface NativeFeeEarnings {
  amount: bigint;
  receipt: NativeFeeReceipt;
  hasDirectCredit: boolean;
}

//@ pure
export function settledThrough(entries: readonly NativeLiabilityEntry[], day: string, count: number): bigint {
  //@ requires 0 <= count && count <= entries.length
  //@ requires forall(i, 0 <= i && i < entries.length && entries[i].kind == "actual" ==> entries[i].amount >= 0)
  //@ ensures \result >= 0
  //@ decreases count
  if (count === 0) return 0n;
  const entry = entries[count - 1];
  const before = settledThrough(entries, day, count - 1);
  return entry.kind === "actual" && entry.settlement.kind === "dated" && entry.settlement.day === day ? before + entry.amount : before;
}

//@ pure
export function pendingMaximum(entries: readonly NativeLiabilityEntry[], bucket: number, count: number): bigint {
  //@ requires 0 <= count && count <= entries.length
  //@ ensures \result >= 0
  //@ ensures forall(j, 0 <= j && j < count && entries[j].kind == "unsettled" && entries[j].bucket == bucket ==> entries[j].maximum <= \result)
  //@ decreases count
  if (count === 0) return 0n;
  const entry = entries[count - 1];
  const before = pendingMaximum(entries, bucket, count - 1);
  return entry.kind === "unsettled" && entry.bucket === bucket && before < entry.maximum ? entry.maximum : before;
}

//@ pure
export function pendingTotal(entries: readonly NativeLiabilityEntry[], buckets: number): bigint {
  //@ requires 0 <= buckets
  //@ ensures \result >= 0
  //@ decreases buckets
  if (buckets === 0) return 0n;
  return pendingTotal(entries, buckets - 1) + pendingMaximum(entries, buckets - 1, entries.length);
}

//@ pure
export function positivePart(amount: bigint): bigint {
  //@ ensures \result >= 0 && \result >= amount
  //@ ensures \result == 0 || \result == amount
  return amount > 0n ? amount : 0n;
}

export function nativeDailyLiability(bucketCount: number, entries: readonly NativeLiabilityEntry[], day: string): bigint {
  //@ requires bucketCount >= 0
  //@ requires forall(i, 0 <= i && i < entries.length && entries[i].kind == "unsettled" ==> 0 <= entries[i].bucket && entries[i].bucket < bucketCount && entries[i].maximum >= 0)
  //@ requires forall(i, 0 <= i && i < entries.length && entries[i].kind == "actual" ==> entries[i].amount >= 0)
  //@ ensures \result == settledThrough(entries, day, entries.length) + pendingTotal(entries, bucketCount)
  //@ ensures \result >= 0
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
    //@ invariant settled == settledThrough(entries, day, i)
    //@ invariant settled >= 0
    //@ invariant forall(k, 0 <= k && k < bucketCount ==> maxima[k] == pendingMaximum(entries, k, i) && maxima[k] >= 0)
    const entry = entries[i];
    if (entry.kind === "actual" && entry.settlement.kind === "dated" && entry.settlement.day === day) settled += entry.amount;
    else if (entry.kind === "unsettled" && maxima[entry.bucket] < entry.maximum) maxima[entry.bucket] = entry.maximum;
    i += 1;
  }
  let total = settled;
  b = 0;
  while (b < bucketCount) {
    //@ invariant 0 <= b && b <= bucketCount
    //@ invariant maxima.length == bucketCount
    //@ invariant settled == settledThrough(entries, day, entries.length)
    //@ invariant total == settled + pendingTotal(entries, b)
    //@ invariant total >= 0
    //@ invariant forall(k, 0 <= k && k < bucketCount ==> maxima[k] == pendingMaximum(entries, k, entries.length) && maxima[k] >= 0)
    total += maxima[b];
    b += 1;
  }
  return total;
}

//@ pure
export function earnedThrough(entries: readonly NativeFeeEarning[], wallet: string, count: number): bigint {
  //@ requires 0 <= count && count <= entries.length
  //@ decreases count
  if (count === 0) return 0n;
  const entry = entries[count - 1];
  const before = earnedThrough(entries, wallet, count - 1);
  if (entry.kind === "conversion") return before - entry.amount;
  if (entry.kind === "claim" || entry.recipient === wallet) return before + entry.amount;
  return before;
}

//@ pure
export function firstReceiptThrough(entries: readonly NativeFeeEarning[], wallet: string, count: number): NativeFeeReceipt {
  //@ requires 0 <= count && count <= entries.length
  //@ decreases count
  if (count === 0) return { kind: "absent" };
  const entry = entries[count - 1];
  const before = firstReceiptThrough(entries, wallet, count - 1);
  if (entry.kind === "conversion" || (entry.kind === "direct" && entry.recipient !== wallet)) return before;
  return before.kind === "absent" || entry.at < before.at ? { kind: "first", at: entry.at } : before;
}

export function nativeFeeEarnings(entries: readonly NativeFeeEarning[], wallet: string): NativeFeeEarnings {
  //@ ensures \result.amount == earnedThrough(entries, wallet, entries.length)
  //@ ensures \result.receipt == firstReceiptThrough(entries, wallet, entries.length)
  //@ ensures \result.hasDirectCredit <==> exists(j, 0 <= j && j < entries.length && entries[j].kind == "direct" && entries[j].recipient == wallet)
  //@ ensures (\result.receipt.kind == "absent") <==> !exists(j, 0 <= j && j < entries.length && (entries[j].kind == "claim" || (entries[j].kind == "direct" && entries[j].recipient == wallet)))
  let amount = 0n;
  let receipt: NativeFeeReceipt = { kind: "absent" };
  let hasDirectCredit = false;
  let i = 0;
  while (i < entries.length) {
    //@ invariant 0 <= i && i <= entries.length
    //@ invariant amount == earnedThrough(entries, wallet, i)
    //@ invariant receipt == firstReceiptThrough(entries, wallet, i)
    //@ invariant hasDirectCredit <==> exists(j, 0 <= j && j < i && entries[j].kind == "direct" && entries[j].recipient == wallet)
    //@ invariant (receipt.kind == "absent") <==> !exists(j, 0 <= j && j < i && (entries[j].kind == "claim" || (entries[j].kind == "direct" && entries[j].recipient == wallet)))
    const entry = entries[i];
    if (entry.kind === "conversion") amount -= entry.amount;
    else if (entry.kind === "claim" || entry.recipient === wallet) {
      amount += entry.amount;
      if (entry.kind === "direct") hasDirectCredit = true;
      if (receipt.kind === "absent" || entry.at < receipt.at) receipt = { kind: "first", at: entry.at };
    }
    i += 1;
  }
  return { amount, receipt, hasDirectCredit };
}

export function nativeFeeRemainder(earned: bigint, bucketCount: number, entries: readonly NativeLiabilityEntry[]): bigint {
  //@ requires bucketCount >= 0
  //@ requires forall(i, 0 <= i && i < entries.length ==> entries[i].kind == "unsettled" && 0 <= entries[i].bucket && entries[i].bucket < bucketCount && entries[i].maximum >= 0)
  //@ ensures \result == positivePart(earned - settledThrough(entries, "", entries.length) - pendingTotal(entries, bucketCount))
  //@ ensures \result >= 0
  const liability = nativeDailyLiability(bucketCount, entries, "");
  return positivePart(earned - liability);
}

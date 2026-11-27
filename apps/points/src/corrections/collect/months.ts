//@ backend dafny
// spec/points/quotaRecovery.md, "Only trusted production runs can restore the original campaign"

export interface MonthPart {
  from: number;
  to: number;
}

export const cutoffMillis = 3024000000;

//@ pure
function leap(year: number): boolean {
  //@ requires year >= 0
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

//@ pure
function monthDays(year: number, month: number): number {
  //@ requires year >= 0 && 1 <= month && month <= 12
  //@ ensures 28 <= \result && \result <= 31
  if (month === 2) return leap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

//@ pure
export function monthStartAfter(at: number, year: number, month: number, start: number): number {
  //@ requires 0 <= at && 0 <= year && 1 <= month && month <= 12 && 0 <= start
  //@ ensures \result > at
  //@ ensures \result >= start
  //@ ensures start > at ==> \result === start
  //@ ensures start <= at ==> \result - 2678400000 <= at
  //@ decreases at - start
  if (start > at) return start;
  const next = start + monthDays(year, month) * 86400000;
  if (next > at) return next;
  return month === 12 ? monthStartAfter(at, year + 1, 1, next) : monthStartAfter(at, year, month + 1, next);
}

//@ pure
export function nextMonthStart(at: number): number {
  //@ requires at >= 0
  //@ ensures \result > at
  //@ ensures \result - 2678400000 <= at
  return monthStartAfter(at, 1970, 1, 0);
}

//@ pure
export function secondFloor(millis: number): number {
  //@ requires millis >= 0
  //@ ensures \result <= millis && millis < \result + 1000 && \result % 1000 === 0 && \result >= 0
  return millis - millis % 1000;
}

//@ pure
export function cutoffBefore(through: number): number {
  //@ ensures \result === through - 3024000000
  return through - cutoffMillis;
}

function nextMonthStartFrom(at: number): number {
  //@ requires at >= 0
  //@ ensures \result === nextMonthStart(at)
  //@ ensures \result > at
  //@ ensures \result - 2678400000 <= at
  let year = 1970;
  let month = 1;
  let start = 0;
  while (start <= at) {
    //@ invariant 0 <= year && 1 <= month && month <= 12 && 0 <= start && start <= at
    //@ invariant monthStartAfter(at, year, month, start) === nextMonthStart(at)
    //@ decreases at - start
    const days = monthDays(year, month);
    const next = start + days * 86400000;
    if (next > at) return next;
    if (month === 12) {
      year = year + 1;
      month = 1;
    } else {
      month = month + 1;
    }
    start = next;
  }
  return start;
}

/** @throws {never} */
export function censusParts(start: number, end: number): MonthPart[] {
  //@ requires 0 <= start && start < end
  //@ ensures \result.length > 0
  //@ ensures \result[0].from === start
  //@ ensures \result[\result.length - 1].to === end
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k].from < \result[k].to)
  //@ ensures forall(k, 0 <= k && k < \result.length ==> start <= \result[k].from && \result[k].to <= end)
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k].to === (nextMonthStart(\result[k].from) < end ? nextMonthStart(\result[k].from) : end))
  //@ ensures forall(k, 0 < k && k < \result.length ==> \result[k].from === \result[k - 1].to)
  const parts: MonthPart[] = [];
  let from = start;
  while (from < end) {
    //@ invariant start <= from && from <= end
    //@ invariant parts.length === 0 ==> from === start
    //@ invariant parts.length > 0 ==> parts[0].from === start && parts[parts.length - 1].to === from
    //@ invariant forall(k, 0 <= k && k < parts.length ==> parts[k].from < parts[k].to)
    //@ invariant forall(k, 0 <= k && k < parts.length ==> start <= parts[k].from && parts[k].to <= from)
    //@ invariant forall(k, 0 <= k && k < parts.length ==> parts[k].to === (nextMonthStart(parts[k].from) < end ? nextMonthStart(parts[k].from) : end))
    //@ invariant forall(k, 0 < k && k < parts.length ==> parts[k].from === parts[k - 1].to)
    //@ decreases end - from
    const next = nextMonthStartFrom(from);
    const to = next < end ? next : end;
    parts.push({ from: from, to: to });
    from = to;
  }
  return parts;
}

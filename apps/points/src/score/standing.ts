//@ backend dafny
// spec/points/journal.md, "One current accepted unit is credited once with its whole value"; spec/points/penalties.md, "Standing is the month's accepted-work credits minus active debits, never below zero, whatever the order"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"

export interface CreditKey {
  actor: string;
  project: string;
  month: string;
  unit: string;
  source: string;
  merged: boolean;
}

export interface Consumption {
  applied: number[];
  remaining: number;
}

/** @throws {never} */
//@ pure
export function sameActorUnit(earlier: CreditKey, key: CreditKey): boolean {
  //@ ensures \result === (earlier.actor === key.actor && earlier.project === key.project && earlier.month === key.month && earlier.unit === key.unit)
  return earlier.actor === key.actor && earlier.project === key.project && earlier.month === key.month && earlier.unit === key.unit;
}

/** @throws {never} */
//@ pure
export function otherMergedSource(earlier: CreditKey, key: CreditKey): boolean {
  //@ ensures \result === (key.merged && earlier.merged && earlier.month === key.month && earlier.unit === key.unit && earlier.source !== key.source)
  return key.merged && earlier.merged && earlier.month === key.month && earlier.unit === key.unit && earlier.source !== key.source;
}

/** @throws {never} */
//@ pure
export function conflicts(earlier: CreditKey, key: CreditKey): boolean {
  //@ ensures \result === (sameActorUnit(earlier, key) || otherMergedSource(earlier, key))
  return sameActorUnit(earlier, key) || otherMergedSource(earlier, key);
}

/** @throws {never} */
export function admits(credited: CreditKey[], key: CreditKey): boolean {
  //@ ensures \result ==> forall(k, 0 <= k && k < credited.length ==> !sameActorUnit(credited[k], key))
  //@ ensures \result ==> forall(k, 0 <= k && k < credited.length ==> !otherMergedSource(credited[k], key))
  let i = 0;
  while (i < credited.length) {
    //@ invariant 0 <= i && i <= credited.length
    //@ invariant forall(k, 0 <= k && k < i ==> !conflicts(credited[k], key))
    if (conflicts(credited[i], key)) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function consume(available: number, debits: number[]): Consumption {
  //@ requires available >= 0
  //@ ensures \result.applied.length === debits.length
  //@ ensures 0 <= \result.remaining && \result.remaining <= available
  //@ ensures forall(k, 0 <= k && k < debits.length ==> 0 <= \result.applied[k] && (debits[k] >= 0 ==> \result.applied[k] <= debits[k]))
  //@ ensures forall(k, 0 <= k && k < debits.length ==> \result.applied[k] <= available)
  const applied: number[] = [];
  let remaining = available;
  let i = 0;
  while (i < debits.length) {
    //@ invariant 0 <= i && i <= debits.length
    //@ invariant applied.length === i
    //@ invariant 0 <= remaining && remaining <= available
    //@ invariant forall(k, 0 <= k && k < i ==> 0 <= applied[k] && (debits[k] >= 0 ==> applied[k] <= debits[k]) && applied[k] <= available)
    const debit = debits[i] > 0 ? debits[i] : 0;
    const taken = debit < remaining ? debit : remaining;
    applied.push(taken);
    remaining = remaining - taken;
    i = i + 1;
  }
  return { applied: applied, remaining: remaining };
}

/** @throws {never} */
export function rankOf(totals: number[], points: number): number {
  //@ ensures 1 <= \result && \result <= totals.length + 1
  let higher = 0;
  let i = 0;
  while (i < totals.length) {
    //@ invariant 0 <= i && i <= totals.length
    //@ invariant 0 <= higher && higher <= i
    if (totals[i] > points) higher = higher + 1;
    i = i + 1;
  }
  return 1 + higher;
}

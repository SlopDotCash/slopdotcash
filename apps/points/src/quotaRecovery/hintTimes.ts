//@ backend dafny
// spec/points/quotaRecovery.md, "Quota waits use the strictest safe observation from the drained pass"

export const latestSafeHint = 9007199254680991;

/** @throws {never} */
export function hintTime(millis: number): number {
  //@ ensures \result === 0 || (\result === millis && 0 < millis && millis <= 9007199254680991)
  //@ ensures (0 < millis && millis <= 9007199254680991) ==> \result === millis
  return 0 < millis && millis <= latestSafeHint ? millis : 0;
}

/** @throws {never} */
export function secondsLater(now: number, seconds: number): number {
  //@ requires seconds >= 0
  //@ ensures \result === now + seconds * 1000
  return now + seconds * 1000;
}

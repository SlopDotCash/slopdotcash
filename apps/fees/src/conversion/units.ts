//@ backend dafny
// spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"

//@ pure
export function isSafe(value: bigint): boolean {
  //@ ensures \result <==> (0 <= value && value <= 9007199254740991)
  return value >= 0n && value <= 9007199254740991n;
}

//@ pure
export function exactNumber(value: bigint): number {
  //@ requires 0 <= value && value <= 9007199254740991
  //@ ensures \result == value
  return Number(value);
}

//@ pure
export function quoteValue(value: bigint): number {
  //@ requires value >= 0
  //@ ensures value <= 9007199254740991 ==> \result == value
  //@ ensures value > 9007199254740991 ==> \result == 9007199254740992
  return value > 9007199254740991n ? 9007199254740992 : Number(value);
}

//@ pure
export function wide(value: number): bigint {
  //@ requires -9007199254740991 <= value && value <= 9007199254740991
  //@ ensures \result == value
  return BigInt(value);
}

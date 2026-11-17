//@ backend dafny
// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"

//@ pure
export function nativeUnits(wei: bigint, solana: boolean): bigint {
  //@ requires wei >= 0
  //@ ensures \result >= 0
  //@ ensures solana ==> \result == wei
  //@ ensures !solana ==> (\result - 1) * 1000000000 < wei && wei <= \result * 1000000000
  return solana ? wei : (wei + 999999999n) / 1000000000n;
}

//@ pure
export function nativeWei(units: bigint, solana: boolean): bigint {
  //@ requires units >= 0
  //@ ensures \result >= 0
  //@ ensures solana ==> \result == units
  //@ ensures !solana ==> \result == units * 1000000000
  return solana ? units : units * 1000000000n;
}

//@ pure
export function overran(actual: bigint, maximum: bigint): boolean {
  //@ ensures \result <==> actual > maximum
  return actual > maximum;
}

//@ pure
export function withinReservation(gas: bigint, feePerGas: bigint, maximum: bigint): boolean {
  //@ requires gas >= 0 && feePerGas >= 0
  //@ ensures \result <==> gas * feePerGas <= maximum
  return gas * feePerGas <= maximum;
}

//@ pure
export function sumOf(values: readonly bigint[], count: number): bigint {
  //@ requires 0 <= count && count <= values.length
  //@ requires forall(i, 0 <= i && i < values.length ==> values[i] >= 0)
  //@ ensures \result >= 0
  //@ ensures count > 0 ==> \result >= values[count - 1]
  //@ decreases count
  if (count === 0) return 0n;
  return sumOf(values, count - 1) + values[count - 1];
}

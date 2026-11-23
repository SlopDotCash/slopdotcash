//@ backend dafny
// spec/fees/submissionFeeRate.md, "One reading per UTC hour; a new SLOP rate needs enough readings and takes effect at the next hour"

//@ pure
export function slopPriceOf(scaled: bigint): bigint {
  //@ requires scaled > 0
  //@ ensures \result >= 0
  //@ ensures \result * scaled <= 1000000000000000000000000000000000000
  //@ ensures 1000000000000000000000000000000000000 < (\result + 1) * scaled
  return 1000000000000000000000000000000000000n / scaled;
}

//@ pure
export function harmonicRate(count: bigint, prices: bigint): bigint {
  //@ requires count > 0 && prices > 0
  //@ ensures \result >= 0
  //@ ensures \result * prices <= 1000000000000000000000000000000000000 * count
  //@ ensures 1000000000000000000000000000000000000 * count < (\result + 1) * prices
  return (1000000000000000000000000000000000000n * count) / prices;
}

//@ pure
export function feeShareBps(shareBps: bigint, rateInForce: bigint, market: bigint): bigint {
  //@ requires shareBps >= 0 && rateInForce > 0 && market > 0
  //@ ensures \result >= 0
  //@ ensures \result * market <= shareBps * rateInForce
  //@ ensures shareBps * rateInForce < (\result + 1) * market
  return (shareBps * rateInForce) / market;
}

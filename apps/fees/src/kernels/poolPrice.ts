//@ backend dafny
// spec/fees/submissionFeeRate.md, "One reading per UTC hour; a new SLOP rate needs enough readings and takes effect at the next hour"

const Q192 = 6277101735386680763835789423207666416102355444464034512896n;

//@ pure
export function slopPerStableScaled(sqrtPriceX96: bigint): bigint {
  //@ requires sqrtPriceX96 >= 0
  //@ ensures \result >= 0
  //@ ensures \result * Q192 <= sqrtPriceX96 * sqrtPriceX96 * 1000000
  //@ ensures sqrtPriceX96 * sqrtPriceX96 * 1000000 < (\result + 1) * Q192
  return (sqrtPriceX96 * sqrtPriceX96 * 1000000n) / Q192;
}

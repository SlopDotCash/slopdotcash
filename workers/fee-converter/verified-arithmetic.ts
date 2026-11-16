/** Exact arithmetic used by the live fee-conversion paths. */

/** Rounds a nonnegative rational toward the selected safe monetary bound. */
//@ verify
//@ pure
//@ requires numerator >= 0 && denominator > 0
//@ ensures \result >= 0
//@ ensures !up ==> \result * denominator <= numerator && numerator < (\result + 1) * denominator
//@ ensures up ==> (\result - 1) * denominator < numerator && numerator <= \result * denominator
export function roundedDivision(
  numerator: bigint,
  denominator: bigint,
  up: boolean,
): bigint {
  return up
    ? (numerator + denominator - 1n) / denominator
    : numerator / denominator;
}

/** The signed slippage minimum is the floor, never a floating-point estimate. */
//@ verify
//@ pure
//@ requires amountOut >= 0 && slippageBps >= 0 && slippageBps <= 10000
//@ ensures 0 <= \result && \result <= amountOut
//@ ensures \result * 10000 <= amountOut * (10000 - slippageBps)
//@ ensures amountOut * (10000 - slippageBps) < (\result + 1) * 10000
export function minimumOutput(amountOut: bigint, slippageBps: bigint): bigint {
  return (amountOut * (10_000n - slippageBps)) / 10_000n;
}

//@ verify
//@ pure
//@ requires slippageBps >= 0 && slippageBps <= 10000
//@ ensures \result <==> amountOut > 0 && minAmountOut >= minimumOutput(amountOut, slippageBps) && minAmountOut <= amountOut
export function acceptableMinimum(
  amountOut: bigint,
  minAmountOut: bigint,
  slippageBps: bigint,
): boolean {
  return (
    amountOut > 0n &&
    minAmountOut >= minimumOutput(amountOut, slippageBps) &&
    minAmountOut <= amountOut
  );
}

/** A quote must fit both independent caps, including already exhausted caps. */
//@ verify
//@ pure
//@ ensures \result <= runCap - runUsed && \result <= dayCap - dayUsed
//@ ensures \result == runCap - runUsed || \result == dayCap - dayUsed
export function remainingBudget(
  runCap: bigint,
  runUsed: bigint,
  dayCap: bigint,
  dayUsed: bigint,
): bigint {
  const run = runCap - runUsed;
  const day = dayCap - dayUsed;
  return run < day ? run : day;
}

/** Requotes reduce the input strictly and target 98% of the remaining cap. */
//@ verify
//@ pure
//@ requires amount > 0 && remaining > 0 && quotedOut > remaining
//@ ensures 0 <= \result && \result < amount
//@ ensures \result * quotedOut * 100 <= amount * remaining * 98
//@ ensures amount * remaining * 98 < (\result + 1) * quotedOut * 100
export function rescaleInput(
  amount: bigint,
  remaining: bigint,
  quotedOut: bigint,
): bigint {
  return (amount * remaining * 98n) / (quotedOut * 100n);
}

/** Reserve native fees before considering principal available for conversion. */
//@ verify
//@ pure
//@ requires balance >= 0 && reserve >= 0
//@ ensures 0 <= \result && \result <= balance
//@ ensures balance <= reserve ==> \result == 0
//@ ensures balance > reserve ==> \result + reserve == balance
export function spendableNative(balance: bigint, reserve: bigint): bigint {
  return balance > reserve ? balance - reserve : 0n;
}

//@ verify
//@ pure
//@ requires before >= 0 && after >= 0
//@ ensures \result >= 0
//@ ensures after <= before ==> \result == 0
//@ ensures after > before ==> \result == after - before
export function rentIncrease(before: bigint, after: bigint): bigint {
  return after > before ? after - before : 0n;
}

//@ verify
//@ pure
//@ ensures \result >= left && \result >= right
//@ ensures \result == left || \result == right
export function greaterAmount(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

/** Loss is rounded upward, so the configured impact cap cannot be understated. */
//@ verify
//@ pure
//@ requires inputValue > 0 && outputValue >= 0
//@ ensures 0 <= \result && \result <= 10000
//@ ensures outputValue >= inputValue ==> \result == 0
//@ ensures outputValue < inputValue ==> (\result - 1) * inputValue < (inputValue - outputValue) * 10000 && (inputValue - outputValue) * 10000 <= \result * inputValue
export function priceImpactCeiling(
  inputValue: bigint,
  outputValue: bigint,
): bigint {
  return inputValue > outputValue
    ? ((inputValue - outputValue) * 10_000n + inputValue - 1n) / inputValue
    : 0n;
}

/** Preserve transaction/rent charges while excluding the intended principal. */
//@ verify
//@ requires fee >= 0 && rent >= 0 && before >= 0 && after >= 0 && principal >= 0
//@ ensures \result >= fee + rent && \result >= before - after - principal
//@ ensures \result == fee + rent || \result == before - after - principal
//@ ensures before - after - principal <= fee + rent ==> \result == fee + rent
export function solanaNativeFee(
  fee: bigint,
  rent: bigint,
  before: bigint,
  after: bigint,
  principal: bigint,
): bigint {
  return greaterAmount(fee + rent, before - after - principal);
}

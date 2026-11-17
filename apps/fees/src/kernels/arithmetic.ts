//@ backend dafny
// spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"; spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"

//@ pure
export function roundedDivision(numerator: bigint, denominator: bigint, up: boolean): bigint {
  //@ requires numerator >= 0 && denominator > 0
  //@ ensures \result >= 0
  //@ ensures !up ==> \result * denominator <= numerator && numerator < (\result + 1) * denominator
  //@ ensures up ==> (\result - 1) * denominator < numerator && numerator <= \result * denominator
  return up ? (numerator + denominator - 1n) / denominator : numerator / denominator;
}

//@ pure
export function minimumOutput(amountOut: bigint, slippageBps: bigint): bigint {
  //@ requires amountOut >= 0 && slippageBps >= 0 && slippageBps <= 10000
  //@ ensures 0 <= \result && \result <= amountOut
  //@ ensures \result * 10000 <= amountOut * (10000 - slippageBps)
  //@ ensures amountOut * (10000 - slippageBps) < (\result + 1) * 10000
  return (amountOut * (10000n - slippageBps)) / 10000n;
}

//@ pure
export function acceptableMinimum(amountOut: bigint, minAmountOut: bigint, slippageBps: bigint): boolean {
  //@ requires slippageBps >= 0 && slippageBps <= 10000
  //@ ensures \result <==> amountOut > 0 && minAmountOut >= minimumOutput(amountOut, slippageBps) && minAmountOut <= amountOut
  return amountOut > 0n && minAmountOut >= minimumOutput(amountOut, slippageBps) && minAmountOut <= amountOut;
}

//@ pure
export function remainingBudget(runCap: bigint, runUsed: bigint, dayCap: bigint, dayUsed: bigint): bigint {
  //@ ensures \result <= runCap - runUsed && \result <= dayCap - dayUsed
  //@ ensures \result == runCap - runUsed || \result == dayCap - dayUsed
  const run = runCap - runUsed;
  const day = dayCap - dayUsed;
  return run < day ? run : day;
}

//@ pure
export function rescaleInput(amount: bigint, remaining: bigint, quotedOut: bigint): bigint {
  //@ requires amount > 0 && remaining > 0 && quotedOut > remaining
  //@ ensures 0 <= \result && \result < amount
  //@ ensures \result * quotedOut * 100 <= amount * remaining * 98
  //@ ensures amount * remaining * 98 < (\result + 1) * quotedOut * 100
  return (amount * remaining * 98n) / (quotedOut * 100n);
}

//@ pure
export function spendableNative(balance: bigint, reserve: bigint): bigint {
  //@ requires balance >= 0 && reserve >= 0
  //@ ensures 0 <= \result && \result <= balance
  //@ ensures balance <= reserve ==> \result == 0
  //@ ensures balance > reserve ==> \result + reserve == balance
  return balance > reserve ? balance - reserve : 0n;
}

//@ pure
export function rentIncrease(before: bigint, after: bigint): bigint {
  //@ requires before >= 0 && after >= 0
  //@ ensures \result >= 0
  //@ ensures after <= before ==> \result == 0
  //@ ensures after > before ==> \result == after - before
  return after > before ? after - before : 0n;
}

//@ pure
export function greaterAmount(left: bigint, right: bigint): bigint {
  //@ ensures \result >= left && \result >= right
  //@ ensures \result == left || \result == right
  return left > right ? left : right;
}

//@ pure
export function priceImpactCeiling(inputValue: bigint, outputValue: bigint): bigint {
  //@ requires inputValue > 0 && outputValue >= 0
  //@ ensures 0 <= \result && \result <= 10000
  //@ ensures outputValue >= inputValue ==> \result == 0
  //@ ensures outputValue < inputValue ==> (\result - 1) * inputValue < (inputValue - outputValue) * 10000 && (inputValue - outputValue) * 10000 <= \result * inputValue
  return inputValue > outputValue ? ((inputValue - outputValue) * 10000n + inputValue - 1n) / inputValue : 0n;
}

//@ pure
export function solanaNativeFee(fee: bigint, rent: bigint, before: bigint, after: bigint, principal: bigint): bigint {
  //@ requires fee >= 0 && rent >= 0 && before >= 0 && after >= 0 && principal >= 0
  //@ ensures \result >= fee + rent && \result >= before - after - principal
  //@ ensures \result == fee + rent || \result == before - after - principal
  //@ ensures before - after - principal <= fee + rent ==> \result == fee + rent
  return greaterAmount(fee + rent, before - after - principal);
}

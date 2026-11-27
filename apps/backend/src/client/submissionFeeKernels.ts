//@ backend dafny
// spec/backend/submissionFeeTerms.md, "The submission fee terms are published constants that change only by a reviewed change"; spec/backend/submissionFeeTerms.md, "A SLOP rate is in force from its own hour, and the previous one still counts for 48 hours"

export const rateScale = 1000000000000000000n;
export const rateTextUnit = 1000000000000n;
export const basisPoints = 10000n;

/** @throws {never} */
//@ pure
export function significantUnit(value: bigint): bigint {
  //@ requires value > 0
  //@ decreases value
  //@ ensures \result >= 1 && \result * 100 > value
  //@ ensures \result === 1 || \result * 10 <= value
  return value < 100n ? 1n : significantUnit(value / 10n) * 10n;
}

/** @throws {never} */
//@ pure
export function twoSignificant(value: bigint): bigint {
  //@ requires value > 0
  //@ ensures \result > 0
  const unit = significantUnit(value);
  return unit > 0n ? ((value + unit / 2n) / unit) * unit : 0n;
}

/** @throws {never} */
//@ pure
export function slopFeeUnits(stableMinor: bigint, rateScaled: bigint, shareBps: bigint, stableUnit: bigint): bigint {
  //@ requires stableMinor > 0 && rateScaled > 0 && shareBps > 0 && stableUnit > 0
  //@ ensures \result >= 0
  //@ ensures \result === 0 <==> stableMinor * rateScaled * shareBps < stableUnit * 10000
  const exact = (stableMinor * rateScaled * shareBps) / (stableUnit * basisPoints);
  return exact > 0n ? twoSignificant(exact) : 0n;
}

/** @throws {never} */
//@ pure
export function lowerAmount(left: bigint, right: bigint): bigint {
  //@ ensures \result <= left && \result <= right
  //@ ensures \result === left || \result === right
  return right < left ? right : left;
}

/** @throws {never} */
//@ pure
export function rateMicros(scaled: bigint): bigint {
  //@ requires scaled > 0
  //@ ensures \result >= 0
  //@ ensures \result * 1000000000000 <= scaled + 500000000000 && scaled + 500000000000 < (\result + 1) * 1000000000000
  return (scaled + rateTextUnit / 2n) / rateTextUnit;
}

/** @throws {never} */
//@ pure
export function inStableLimits(amount: bigint, minimum: bigint, maximum: bigint): boolean {
  //@ ensures \result <==> minimum <= amount && amount <= maximum
  return amount >= minimum && amount <= maximum;
}

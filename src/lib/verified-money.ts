/** Exact integer kernels used by rewards, funding, and settlement. */

export interface WeightedShare {
  amount: bigint;
  remainder: bigint;
}

/** A largest-remainder term before the deterministic tie-break and distribution. */
//@ verify
//@ pure
//@ requires total >= 0 && weight >= 0 && totalWeight > 0 && weight <= totalWeight
//@ ensures \result.amount >= 0 && \result.amount <= total
//@ ensures \result.remainder >= 0 && \result.remainder < totalWeight
//@ ensures \result.amount * totalWeight + \result.remainder == total * weight
export function weightedShare(
  total: bigint,
  weight: bigint,
  totalWeight: bigint,
): WeightedShare {
  const numerator = total * weight;
  return {
    amount: numerator / totalWeight,
    remainder: numerator % totalWeight,
  };
}

/** Current ordinary payouts charge two percent, rounded upward. */
//@ verify
//@ pure
//@ ensures \result >= 0
//@ ensures gross <= 0 ==> \result == 0
//@ ensures gross > 0 ==> \result <= gross
//@ ensures gross > 0 ==> (\result - 1) * 50 < gross && gross <= \result * 50
export function ordinaryFeeAmount(gross: bigint): bigint {
  return gross > 0n ? (gross + 49n) / 50n : 0n;
}

/** Historical floor rounding remains acceptable; no third fee amount does. */
//@ verify
//@ pure
//@ requires gross > 0
//@ ensures \result <==> fee == ordinaryFeeAmount(gross) || fee == gross / 50
//@ ensures \result ==> fee >= 0 && fee <= gross
export function ordinaryFeeMatches(gross: bigint, fee: bigint): boolean {
  const expected = ordinaryFeeAmount(gross);
  return fee === expected || (fee === gross / 50n && fee + 1n === expected);
}

/** Private bounties use an exact one-quarter fee and never an ordinary fee. */
//@ verify
//@ pure
//@ requires gross > 0 && gross % 4 == 0
//@ ensures \result > 0 && \result * 4 == gross
//@ ensures gross - \result == 3 * \result
export function bountyFeeAmount(gross: bigint): bigint {
  return gross / 4n;
}

/** Native execution charge before chain-specific data and operator fees. */
//@ verify
//@ requires gasUsed >= 0 && gasPrice >= 0
//@ ensures \result == gasUsed * gasPrice
//@ ensures \result >= 0
//@ ensures gasUsed == 0 || gasPrice == 0 ==> \result == 0
export function executionGasCost(gasUsed: bigint, gasPrice: bigint): bigint {
  return gasUsed * gasPrice;
}

/** Every witnessed native fee component is included once. */
//@ verify
//@ requires execution >= 0 && blob >= 0 && data >= 0 && operator >= 0
//@ ensures \result == execution + blob + data + operator
//@ ensures \result >= execution && \result >= blob && \result >= data && \result >= operator
export function nativeFeeTotal(
  execution: bigint,
  blob: bigint,
  data: bigint,
  operator: bigint,
): bigint {
  return execution + blob + data + operator;
}

/** The fee is removed from the payer's balance change only. */
//@ verify
//@ requires before >= 0 && after >= 0 && fee >= 0
//@ ensures \result + before == after + (payer ? fee : 0)
//@ ensures !payer ==> \result == after - before
//@ ensures payer ==> \result == after - before + fee
export function normalizedNativeDelta(
  before: bigint,
  after: bigint,
  fee: bigint,
  payer: boolean,
): bigint {
  return after - before + (payer ? fee : 0n);
}

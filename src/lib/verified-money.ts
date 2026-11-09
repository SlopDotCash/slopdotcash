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

/** Parsed rows retain the exact recipient and source strings of the proposal. */
export interface MonthlyAmountRow {
  githubUserId: string;
  login: string;
  gross: bigint;
  sourceDigest: string;
}

export interface FrozenAmountAward extends MonthlyAmountRow {
  fee: bigint;
  net: bigint;
}

export interface FrozenAmounts {
  awards: FrozenAmountAward[];
  total: bigint;
}

/** Every nonzero proposal row becomes one award, in the original row order. */
//@ verify
//@ requires forall(i, 0 <= i && i < rows.length ==> rows[i].gross >= 0)
//@ ensures \result.awards == FrozenRows(rows, legacyFloorFee)
//@ ensures \result.total == RowTotal(rows)
//@ ensures \result.total == AwardTotal(\result.awards)
//@ ensures \result.total == AwardNetTotal(\result.awards) + AwardFeeTotal(\result.awards)
//@ ensures \result.awards.length == NonzeroRows(rows)
//@ ensures forall(i, 0 <= i && i < \result.awards.length ==> \result.awards[i].gross != 0 && \result.awards[i].fee == FrozenFee(\result.awards[i].gross, legacyFloorFee) && \result.awards[i].gross == \result.awards[i].fee + \result.awards[i].net)
//@ ensures forall(i, 0 <= i && i < \result.awards.length ==> \result.awards[i].gross > 0 && 0 <= \result.awards[i].fee && \result.awards[i].fee <= \result.awards[i].gross && \result.awards[i].net >= 0)
export function freezeMonthlyAmounts(
  rows: MonthlyAmountRow[],
  legacyFloorFee: boolean,
): FrozenAmounts {
  const awards: FrozenAmountAward[] = [];
  let total = 0n;
  let i = 0;
  while (i < rows.length) {
    //@ invariant 0 <= i && i <= rows.length
    //@ invariant awards == FrozenRows(rows.slice(0, i), legacyFloorFee)
    //@ invariant total == RowTotal(rows.slice(0, i))
    //@ invariant total == AwardTotal(awards)
    //@ invariant total == AwardNetTotal(awards) + AwardFeeTotal(awards)
    //@ invariant awards.length == NonzeroRows(rows.slice(0, i))
    //@ invariant forall(k, 0 <= k && k < awards.length ==> awards[k].gross != 0 && awards[k].fee == FrozenFee(awards[k].gross, legacyFloorFee) && awards[k].gross == awards[k].fee + awards[k].net)
    //@ invariant forall(k, 0 <= k && k < awards.length ==> awards[k].gross > 0 && 0 <= awards[k].fee && awards[k].fee <= awards[k].gross && awards[k].net >= 0)
    const row = rows[i];
    if (row.gross !== 0n) {
      const fee = legacyFloorFee
        ? row.gross / 50n
        : ordinaryFeeAmount(row.gross);
      awards.push({
        githubUserId: row.githubUserId,
        login: row.login,
        gross: row.gross,
        sourceDigest: row.sourceDigest,
        fee,
        net: row.gross - fee,
      });
      total += row.gross;
    }
    i += 1;
  }
  return { awards, total };
}

/**
 * A recorded payout fee is acceptable for its gross: a private security
 * bounty's exact quarter, or either rounding of the ordinary 2% fee.
 */
//@ verify
//@ pure
//@ requires gross > 0
//@ ensures \result <==> (bounty ? gross % 4 == 0 && fee * 4 == gross : fee == ordinaryFeeAmount(gross) || fee == gross / 50)
//@ ensures \result ==> 0 <= fee && fee <= gross
export function payoutFeeAccepted(
  gross: bigint,
  fee: bigint,
  bounty: boolean,
): boolean {
  if (bounty) return gross % 4n === 0n && fee === bountyFeeAmount(gross);
  return ordinaryFeeMatches(gross, fee);
}

/** Recorded payout amounts: positive gross within the vault limit, an accepted fee, and gross = fee + net. */
//@ verify
//@ pure
//@ ensures \result <==> gross > 0 && gross <= 340282366920938463463374607431768211455n && payoutFeeAccepted(gross, fee, bounty) && gross == fee + net
//@ ensures \result ==> 0 <= fee && fee <= gross && 0 <= net && net <= gross
export function payoutAmountsAccepted(
  gross: bigint,
  fee: bigint,
  net: bigint,
  bounty: boolean,
): boolean {
  return (
    gross > 0n &&
    gross <= 340282366920938463463374607431768211455n &&
    payoutFeeAccepted(gross, fee, bounty) &&
    gross === fee + net
  );
}

export interface CombinedAward {
  gross: bigint;
  fee: bigint;
  net: bigint;
}

export interface CombinedAwards {
  ok: boolean;
  awards: CombinedAward[];
}

/**
 * Adds each actor's shared-pool and review-budget amounts and deducts the
 * ordinary fee. Refuses (ok false, no awards) a negative amount or a line
 * total above its cap. AmountSum and AwardGrossSum are the proof's sums.
 */
//@ verify
//@ requires pool.length == review.length
//@ ensures \result.ok <==> forall(k, 0 <= k && k < pool.length ==> pool[k] >= 0 && review[k] >= 0) && AmountSum(pool) <= cap && AmountSum(review) <= reviewCap
//@ ensures !\result.ok ==> \result.awards.length == 0
//@ ensures \result.ok ==> \result.awards.length == pool.length && AwardGrossSum(\result.awards) == AmountSum(pool) + AmountSum(review)
//@ ensures \result.ok ==> AwardGrossSum(\result.awards) <= cap + reviewCap
//@ ensures \result.ok ==> forall(k, 0 <= k && k < \result.awards.length ==> \result.awards[k].gross == pool[k] + review[k] && \result.awards[k].fee == ordinaryFeeAmount(\result.awards[k].gross) && \result.awards[k].fee + \result.awards[k].net == \result.awards[k].gross && \result.awards[k].net >= 0 && \result.awards[k].fee >= 0)
export function combineAwards(
  pool: bigint[],
  review: bigint[],
  cap: bigint,
  reviewCap: bigint,
): CombinedAwards {
  const awards: CombinedAward[] = [];
  let poolTotal = 0n;
  let reviewTotal = 0n;
  let i = 0;
  while (i < pool.length) {
    //@ invariant 0 <= i && i <= pool.length && awards.length == i
    //@ invariant forall(k, 0 <= k && k < i ==> pool[k] >= 0 && review[k] >= 0)
    //@ invariant poolTotal == AmountSum(pool.slice(0, i)) && reviewTotal == AmountSum(review.slice(0, i))
    //@ invariant AwardGrossSum(awards) == poolTotal + reviewTotal
    //@ invariant forall(k, 0 <= k && k < i ==> awards[k].gross == pool[k] + review[k] && awards[k].fee == ordinaryFeeAmount(awards[k].gross) && awards[k].fee + awards[k].net == awards[k].gross && awards[k].net >= 0 && awards[k].fee >= 0)
    if (pool[i] < 0n || review[i] < 0n) return { ok: false, awards: [] };
    const gross = pool[i] + review[i];
    const fee = ordinaryFeeAmount(gross);
    awards.push({ gross, fee, net: gross - fee });
    poolTotal += pool[i];
    reviewTotal += review[i];
    i += 1;
  }
  if (poolTotal > cap || reviewTotal > reviewCap)
    return { ok: false, awards: [] };
  return { ok: true, awards };
}

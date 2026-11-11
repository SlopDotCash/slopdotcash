/**
 * Exact arithmetic of the SLOP buyback (PRD section 6, "SLOP buyback and
 * burn"). Every amount is an integer in base units of one asset. Each
 * entitlement is a floor of cumulative verified income less everything
 * already committed, so repeated runs, retries and restarts can never take
 * more than the approved share.
 */

/** The share of cumulative income, rounded down. */
//@ verify
//@ pure
//@ requires income >= 0 && shareBps >= 0 && shareBps <= 10000
//@ ensures 0 <= \result && \result <= income
//@ ensures \result * 10000 <= income * shareBps
//@ ensures income * shareBps < (\result + 1) * 10000
export function shareOf(income: bigint, shareBps: bigint): bigint {
  return (income * shareBps) / 10_000n;
}

/**
 * What one leg may still take: the full-rate credit plus the share of fee
 * income, less every amount already committed to an earlier send. A send
 * stays committed until a verified failure or refund releases it.
 */
//@ verify
//@ pure
//@ requires credit >= 0 && income >= 0 && committed >= 0
//@ requires shareBps >= 0 && shareBps <= 10000
//@ ensures \result >= 0
//@ ensures \result + committed <= credit + shareOf(income, shareBps) || \result == 0
//@ ensures committed <= credit + shareOf(income, shareBps) ==> \result + committed == credit + shareOf(income, shareBps)
export function entitlement(
  credit: bigint,
  income: bigint,
  shareBps: bigint,
  committed: bigint,
): bigint {
  const total = credit + shareOf(income, shareBps);
  return total > committed ? total - committed : 0n;
}

/** A send never exceeds its entitlement, the wallet balance or the value cap. */
//@ verify
//@ pure
//@ requires due >= 0 && balance >= 0 && cap >= 0
//@ ensures 0 <= \result && \result <= due && \result <= balance && \result <= cap
//@ ensures \result == due || \result == balance || \result == cap
export function boundedSend(due: bigint, balance: bigint, cap: bigint): bigint {
  const held = due < balance ? due : balance;
  return held < cap ? held : cap;
}

/**
 * The burn owed on acquired SLOP: the burn share of everything acquired,
 * rounded down, less every burn already committed. The retained remainder is
 * never burned again, because the share is taken of the cumulative total.
 */
//@ verify
//@ pure
//@ requires acquired >= 0 && burned >= 0 && burnBps >= 0 && burnBps <= 10000
//@ ensures \result >= 0
//@ ensures burned <= shareOf(acquired, burnBps) ==> \result + burned == shareOf(acquired, burnBps)
//@ ensures burned > shareOf(acquired, burnBps) ==> \result == 0
export function burnDue(
  acquired: bigint,
  burnBps: bigint,
  burned: bigint,
): bigint {
  const share = shareOf(acquired, burnBps);
  return share > burned ? share - burned : 0n;
}

/**
 * A bridge quote is acceptable when the arrival is positive, never above the
 * input after decimal scaling, and loses at most `maxFeeBps` of it.
 * `inputScaled` and `arrival` are in the arrival asset's base units.
 */
//@ verify
//@ pure
//@ requires inputScaled >= 0 && arrival >= 0 && maxFeeBps >= 0 && maxFeeBps <= 10000
//@ ensures \result ==> arrival > 0 && arrival <= inputScaled
//@ ensures \result ==> (inputScaled - arrival) * 10000 <= inputScaled * maxFeeBps
//@ ensures \result <==> arrival > 0 && arrival <= inputScaled && (inputScaled - arrival) * 10000 <= inputScaled * maxFeeBps
export function bridgeFeeWithin(
  inputScaled: bigint,
  arrival: bigint,
  maxFeeBps: bigint,
): boolean {
  return (
    arrival > 0n &&
    arrival <= inputScaled &&
    (inputScaled - arrival) * 10_000n <= inputScaled * maxFeeBps
  );
}

//@ backend dafny
// spec/fees/buybackPool.md, "Half of all acquired SLOP is burned, and a failed burn retries the same share"; spec/fees/buyback.md, "An EVM order first approves exactly its amount to the pinned bridge"

//@ pure
export function shareOf(income: bigint, shareBps: bigint): bigint {
  //@ requires income >= 0 && shareBps >= 0 && shareBps <= 10000
  //@ ensures 0 <= \result && \result <= income
  //@ ensures \result * 10000 <= income * shareBps
  //@ ensures income * shareBps < (\result + 1) * 10000
  return (income * shareBps) / 10000n;
}

//@ pure
export function entitlement(credit: bigint, income: bigint, shareBps: bigint, committed: bigint): bigint {
  //@ requires credit >= 0 && income >= 0 && committed >= 0
  //@ requires shareBps >= 0 && shareBps <= 10000
  //@ ensures \result >= 0
  //@ ensures \result + committed <= credit + shareOf(income, shareBps) || \result == 0
  //@ ensures committed <= credit + shareOf(income, shareBps) ==> \result + committed == credit + shareOf(income, shareBps)
  const total = credit + shareOf(income, shareBps);
  return total > committed ? total - committed : 0n;
}

//@ pure
export function boundedSend(due: bigint, balance: bigint, cap: bigint): bigint {
  //@ requires due >= 0 && balance >= 0 && cap >= 0
  //@ ensures 0 <= \result && \result <= due && \result <= balance && \result <= cap
  //@ ensures \result == due || \result == balance || \result == cap
  const held = due < balance ? due : balance;
  return held < cap ? held : cap;
}

//@ pure
export function bridgeFeeWithin(inputScaled: bigint, arrival: bigint, maxFeeBps: bigint): boolean {
  //@ requires inputScaled >= 0 && arrival >= 0 && maxFeeBps >= 0 && maxFeeBps <= 10000
  //@ ensures \result ==> arrival > 0 && arrival <= inputScaled
  //@ ensures \result ==> (inputScaled - arrival) * 10000 <= inputScaled * maxFeeBps
  //@ ensures \result <==> arrival > 0 && arrival <= inputScaled && (inputScaled - arrival) * 10000 <= inputScaled * maxFeeBps
  return arrival > 0n && arrival <= inputScaled && (inputScaled - arrival) * 10000n <= inputScaled * maxFeeBps;
}

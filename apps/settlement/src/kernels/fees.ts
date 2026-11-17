//@ backend dafny
// spec/settlement/money.md, "Ordinary fees round upward and private splits require exact division"; spec/settlement/money.md, "Full-width ordinary and private fee calculations conserve every base unit"; spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"

/** @throws {never} */
//@ pure
export function ordinaryFeeBase(gross: bigint): bigint {
  //@ ensures \result >= 0
  //@ ensures gross <= 0 ==> \result === 0
  //@ ensures gross > 0 ==> \result <= gross
  //@ ensures gross > 0 ==> (\result - 1) * 50 < gross && gross <= \result * 50
  return gross > 0n ? (gross + 49n) / 50n : 0n;
}

/** @throws {never} */
export function ordinaryNetBase(gross: bigint): bigint {
  //@ requires gross >= 0
  //@ ensures \result >= 0 && \result <= gross
  //@ ensures \result + ordinaryFeeBase(gross) === gross
  return gross - ordinaryFeeBase(gross);
}

/** @throws {never} */
//@ pure
export function privateSplitPossible(gross: bigint): boolean {
  //@ ensures \result <==> gross > 0 && gross % 4 === 0
  return gross > 0n && gross % 4n === 0n;
}

/** @throws {never} */
export function bountyFeeBase(gross: bigint): bigint {
  //@ requires gross > 0 && gross % 4 === 0
  //@ ensures \result > 0 && \result * 4 === gross
  //@ ensures gross - \result === 3 * \result
  return gross / 4n;
}

/** @throws {never} */
export function bountyResearcherBase(gross: bigint): bigint {
  //@ requires gross > 0 && gross % 4 === 0
  //@ ensures \result > 0 && \result * 4 === 3 * gross
  return gross - gross / 4n;
}

/** @throws {never} */
//@ pure
export function payoutFeeAccepted(gross: bigint, fee: bigint, bounty: boolean): boolean {
  //@ requires gross > 0
  //@ ensures \result <==> (bounty ? gross % 4 === 0 && fee * 4 === gross : fee === ordinaryFeeBase(gross))
  //@ ensures \result ==> 0 <= fee && fee <= gross
  if (bounty) return gross % 4n === 0n && fee * 4n === gross;
  return fee === ordinaryFeeBase(gross);
}

/** @throws {never} */
export function payoutAmountsAccepted(gross: bigint, fee: bigint, net: bigint, bounty: boolean, maximum: bigint): boolean {
  //@ ensures \result <==> gross > 0 && gross <= maximum && payoutFeeAccepted(gross, fee, bounty) && gross === fee + net
  //@ ensures \result ==> 0 <= fee && fee <= gross && 0 <= net && net <= gross
  return gross > 0n && gross <= maximum && payoutFeeAccepted(gross, fee, bounty) && gross === fee + net;
}

//@ backend dafny
// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/terms.md, "A fixed offer permits its receipt-time gross amount or no award"

/** @throws {never} */
//@ pure
export function splitPossible(gross: bigint, full: boolean): boolean {
  //@ ensures \result <==> gross > 0 && (full || gross % 4 === 0)
  return gross > 0n && (full || gross % 4n === 0n);
}

/** @throws {never} */
//@ pure
export function researcherShare(gross: bigint, full: boolean): bigint {
  //@ requires gross > 0 && (full || gross % 4 === 0)
  //@ ensures full ==> \result === gross
  //@ ensures !full ==> \result * 4 === gross * 3
  return full ? gross : (gross / 4n) * 3n;
}

/** @throws {never} */
//@ pure
export function platformShare(gross: bigint, full: boolean): bigint {
  //@ requires gross > 0 && (full || gross % 4 === 0)
  //@ ensures \result >= 0
  //@ ensures researcherShare(gross, full) + \result === gross
  return full ? 0n : gross / 4n;
}

/** @throws {never} */
//@ pure
export function offerAllowed(offered: bigint, chosen: bigint, fixed: boolean, full: boolean): boolean {
  //@ ensures \result <==> splitPossible(chosen, full) && (!fixed || chosen === offered)
  //@ ensures \result ==> chosen > 0
  return splitPossible(chosen, full) && (!fixed || chosen === offered);
}

//@ backend dafny
// spec/settlement/directBounty.md, "A recovered request changes only an unpaid leg after exact retirement"

export interface EvmRecoveryPlan {
  readonly legIndex: number;
  readonly consumed: boolean;
  readonly blockedByLower: boolean;
}

/** @throws {never} */
export function spentLeg(nonces: readonly bigint[], paid: readonly boolean[], finalized: bigint): number {
  //@ requires paid.length === nonces.length
  //@ ensures -1 <= \result && \result < nonces.length
  //@ ensures \result >= 0 ==> 0 <= nonces[\result] && nonces[\result] < finalized && !paid[\result]
  //@ ensures \result >= 0 ==> forall(k, 0 <= k && k < nonces.length && 0 <= nonces[k] && nonces[k] < finalized && !paid[k] ==> nonces[\result] <= nonces[k])
  //@ ensures \result < 0 ==> forall(k, 0 <= k && k < nonces.length ==> !(0 <= nonces[k] && nonces[k] < finalized && !paid[k]))
  let selected = -1;
  let i = 0;
  while (i < nonces.length) {
    //@ invariant 0 <= i && i <= nonces.length
    //@ invariant -1 <= selected && selected < i
    //@ invariant selected >= 0 ==> 0 <= nonces[selected] && nonces[selected] < finalized && !paid[selected]
    //@ invariant selected >= 0 ==> forall(k, 0 <= k && k < i && 0 <= nonces[k] && nonces[k] < finalized && !paid[k] ==> nonces[selected] <= nonces[k])
    //@ invariant selected < 0 ==> forall(k, 0 <= k && k < i ==> !(0 <= nonces[k] && nonces[k] < finalized && !paid[k]))
    if (nonces[i] >= 0n && nonces[i] < finalized && !paid[i] && (selected < 0 || nonces[i] < nonces[selected])) selected = i;
    i += 1;
  }
  return selected;
}

/** @throws {never} */
export function lowerPending(nonces: readonly bigint[], paid: readonly boolean[], finalized: bigint, selected: number): boolean {
  //@ requires paid.length === nonces.length
  //@ requires 0 <= selected && selected < nonces.length
  //@ ensures \result <==> exists(k, 0 <= k && k < nonces.length && k !== selected && 0 <= nonces[k] && !paid[k] && nonces[k] < nonces[selected] && (finalized < 0 || nonces[k] >= finalized))
  let i = 0;
  while (i < nonces.length) {
    //@ invariant 0 <= i && i <= nonces.length
    //@ invariant forall(k, 0 <= k && k < i ==> !(k !== selected && 0 <= nonces[k] && !paid[k] && nonces[k] < nonces[selected] && (finalized < 0 || nonces[k] >= finalized)))
    if (i !== selected && nonces[i] >= 0n && !paid[i] && nonces[i] < nonces[selected] && (finalized < 0n || nonces[i] >= finalized)) return true;
    i += 1;
  }
  return false;
}

/** @throws {never} */
export function planEvmRecovery(nonces: readonly bigint[], paid: readonly boolean[], finalized: bigint, researcherPaid: boolean, targetChanged: boolean): EvmRecoveryPlan {
  //@ requires paid.length === nonces.length
  //@ ensures -1 <= \result.legIndex && \result.legIndex < nonces.length || \result.legIndex === 0
  //@ ensures \result.consumed ==> 0 <= \result.legIndex && \result.legIndex < nonces.length && 0 <= nonces[\result.legIndex] && nonces[\result.legIndex] < finalized && !paid[\result.legIndex]
  //@ ensures \result.blockedByLower ==> 0 <= \result.legIndex && \result.legIndex < nonces.length && 0 <= nonces[\result.legIndex]
  const spent = spentLeg(nonces, paid, finalized);
  const legIndex = spent < 0 && !researcherPaid && targetChanged ? 0 : spent;
  if (legIndex < 0 || legIndex >= nonces.length || nonces[legIndex] < 0n) return { legIndex, consumed: false, blockedByLower: false };
  const blockedByLower = lowerPending(nonces, paid, finalized, legIndex);
  return {
    legIndex,
    consumed: !paid[legIndex] && nonces[legIndex] < finalized,
    blockedByLower,
  };
}

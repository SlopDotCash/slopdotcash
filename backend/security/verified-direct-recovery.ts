export type RecoveryNonce =
  | { kind: "absent" }
  | { kind: "present"; text: string; value: bigint };
export type FinalizedNonce =
  | { kind: "unavailable" }
  | { kind: "known"; value: bigint };
export interface EvmRecoveryPlan {
  legIndex: number;
  nonce: RecoveryNonce;
  consumed: boolean;
  blockedByLower: boolean;
}

//@ verify
//@ ensures \result <==> PaidLeg(paid, index)
function paidLeg(paid: readonly number[], index: number): boolean {
  let i = 0;
  while (i < paid.length) {
    //@ invariant 0 <= i && i <= paid.length
    //@ invariant forall(k, 0 <= k && k < i ==> paid[k] != index)
    if (paid[i] === index) return true;
    i += 1;
  }
  return false;
}

/** Complete unpaid-leg choice and lower-unconsumed-nonce gate. */
//@ verify
//@ ensures \result.legIndex == RecoveryLeg(nonces, paid, finalized, researcherPaid, originalRecipientId, targetId)
//@ ensures \result.nonce == NonceAt(nonces, \result.legIndex)
//@ ensures \result.consumed <==> ConsumedLeg(nonces, paid, finalized, \result.legIndex)
//@ ensures \result.blockedByLower <==> LowerPendingNonce(nonces, paid, finalized, \result.legIndex)
//@ ensures \result.legIndex == -1 || \result.legIndex == 0 || (0 <= \result.legIndex && \result.legIndex < nonces.length)
export function planEvmRecovery(
  nonces: readonly RecoveryNonce[],
  paid: readonly number[],
  finalized: FinalizedNonce,
  researcherPaid: boolean,
  originalRecipientId: string,
  targetId: string,
): EvmRecoveryPlan {
  let selected = -1;
  let lowest = 0n;
  let i = 0;
  while (i < nonces.length) {
    //@ invariant 0 <= i && i <= nonces.length
    //@ invariant selected == SpentLeg(nonces.slice(0, i), paid, finalized)
    //@ invariant -1 <= selected && selected < i
    //@ invariant selected >= 0 ==> nonces[selected].kind == "present" && lowest == nonces[selected].value
    const nonce = nonces[i];
    if (
      finalized.kind === "known" &&
      nonce.kind === "present" &&
      nonce.text !== ""
    ) {
      if (!paidLeg(paid, i) && nonce.value < finalized.value) {
        if (selected < 0 || nonce.value < lowest) {
          selected = i;
          lowest = nonce.value;
        }
      }
    }
    i += 1;
  }
  if (selected < 0 && !researcherPaid && originalRecipientId !== targetId)
    selected = 0;
  let nonce: RecoveryNonce = { kind: "absent" };
  if (selected >= 0 && selected < nonces.length) nonce = nonces[selected];
  let consumed = false;
  if (
    finalized.kind === "known" &&
    nonce.kind === "present" &&
    nonce.text !== ""
  ) {
    if (!paidLeg(paid, selected) && nonce.value < finalized.value)
      consumed = true;
  }
  let blockedByLower = false;
  if (nonce.kind === "present") {
    i = 0;
    while (i < nonces.length) {
      //@ invariant 0 <= i && i <= nonces.length
      //@ invariant blockedByLower <==> LowerPendingPrefix(nonces, paid, finalized, selected, nonce.value, i)
      const other = nonces[i];
      if (i !== selected && other.kind === "present" && other.text !== "") {
        if (!paidLeg(paid, i) && other.value < nonce.value) {
          if (
            finalized.kind === "unavailable" ||
            other.value >= finalized.value
          )
            blockedByLower = true;
        }
      }
      i += 1;
    }
  }
  return { legIndex: selected, nonce, consumed, blockedByLower };
}

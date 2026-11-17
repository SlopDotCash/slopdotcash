//@ backend dafny
// spec/settlement/monthly.md, "Obligations follow the frozen shares exactly, excluding only banned accounts"; spec/settlement/monthlyCommitment.md, "Every attempt is within the frozen allocation and the cap"
import type { ObligationState } from "../../gen/settlement__monthly.ts";

/** @throws {never} */
//@ pure
export function positiveSum(grosses: bigint[], count: number): bigint {
  //@ requires 0 <= count && count <= grosses.length
  //@ decreases count
  if (count === 0) {
    return 0n;
  }
  const last = grosses[count - 1];
  return positiveSum(grosses, count - 1) + (last > 0n ? last : 0n);
}

/** @throws {never} */
export function frozenTotal(grosses: bigint[]): bigint {
  //@ ensures \result === positiveSum(grosses, grosses.length)
  //@ ensures \result >= 0
  let total = 0n;
  let i = 0;
  while (i < grosses.length) {
    //@ invariant 0 <= i && i <= grosses.length
    //@ invariant total === positiveSum(grosses, i)
    //@ invariant total >= 0
    //@ decreases grosses.length - i
    const gross = grosses[i];
    total = total + (gross > 0n ? gross : 0n);
    i = i + 1;
  }
  return total;
}

/** @throws {never} */
//@ pure
export function withinCap(total: bigint, cap: bigint): boolean {
  //@ ensures \result <==> 0 <= total && total <= cap
  return total >= 0n && total <= cap;
}

/** @throws {never} */
//@ pure
export function obligationProgress(held: boolean, sameActor: boolean, sameGross: boolean, feeAccepted: boolean, paid: boolean): ObligationState {
  //@ ensures \result === "Created" <==> !held
  //@ ensures \result === "Conflicted" <==> held && !(sameActor && sameGross && feeAccepted)
  //@ ensures \result === "Paid" <==> held && sameActor && sameGross && feeAccepted && paid
  //@ ensures \result === "Reserved" <==> held && sameActor && sameGross && feeAccepted && !paid
  if (!held) {
    return "Created";
  }
  if (!(sameActor && sameGross && feeAccepted)) {
    return "Conflicted";
  }
  return paid ? "Paid" : "Reserved";
}

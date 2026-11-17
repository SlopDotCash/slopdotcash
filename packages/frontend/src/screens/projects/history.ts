//@ backend dafny
// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"
import { type PoolRead } from "../../../gen/frontend__projections.ts";

export type ShownStatus = "Idle" | "Loading" | "Current" | "Empty" | "Stale" | "Denied" | "Invalid" | "Unavailable" | "Failed" | "Cancelled";

export type Clearance = "loading" | "ready" | "blocked" | "error";

export interface CycleRow {
  readonly follows: boolean;
  readonly firstSeen: boolean;
  readonly amounts: boolean;
  readonly dated: boolean;
  readonly generatedMs: number;
}

/** @throws {never} */
//@ pure
export function poolReadOf(status: ShownStatus): PoolRead {
  //@ ensures \result === "PoolCurrent" <==> (status === "Current" || status === "Empty")
  //@ ensures \result === "PoolStale" <==> status === "Stale"
  //@ ensures \result === "PoolLoading" <==> (status === "Idle" || status === "Loading")
  //@ ensures \result === "PoolFailed" <==> (status === "Denied" || status === "Invalid" || status === "Unavailable" || status === "Failed" || status === "Cancelled")
  if (status === "Current" || status === "Empty") return "PoolCurrent";
  if (status === "Stale") return "PoolStale";
  if (status === "Idle" || status === "Loading") return "PoolLoading";
  return "PoolFailed";
}

/** @throws {never} */
//@ pure
export function clearanceFor(status: ShownStatus, listed: boolean): Clearance {
  //@ ensures \result === "loading" <==> (status === "Idle" || status === "Loading")
  //@ ensures \result === "ready" <==> (listed && (status === "Current" || status === "Stale" || status === "Empty"))
  //@ ensures \result === "blocked" <==> (!listed && (status === "Current" || status === "Stale" || status === "Empty"))
  //@ ensures \result === "error" <==> (status === "Denied" || status === "Invalid" || status === "Unavailable" || status === "Failed" || status === "Cancelled")
  if (status === "Idle" || status === "Loading") return "loading";
  if (status === "Current" || status === "Stale" || status === "Empty") return listed ? "ready" : "blocked";
  return "error";
}

/** @throws {never} */
//@ pure
export function rowValid(row: CycleRow, generatedMs: number): boolean {
  //@ ensures \result <==> (row.follows && row.firstSeen && row.amounts && row.dated && row.generatedMs <= generatedMs)
  return row.follows && row.firstSeen && row.amounts && row.dated && row.generatedMs <= generatedMs;
}

/** @throws {never} */
export function rowsValid(rows: readonly CycleRow[], generatedMs: number): boolean {
  //@ ensures \result <==> forall(i, 0 <= i && i < rows.length ==> rowValid(rows[i], generatedMs))
  let i = 0;
  while (i < rows.length) {
    //@ invariant 0 <= i && i <= rows.length
    //@ invariant forall(k, 0 <= k && k < i ==> rowValid(rows[k], generatedMs))
    //@ decreases rows.length - i
    if (!rowValid(rows[i], generatedMs)) return false;
    i += 1;
  }
  return true;
}

/** @throws {never} */
export function totalOf(amounts: readonly bigint[]): bigint {
  //@ requires forall(i, 0 <= i && i < amounts.length ==> amounts[i] >= 0)
  //@ ensures \result >= 0
  //@ ensures forall(i, 0 <= i && i < amounts.length ==> \result >= amounts[i])
  let total = 0n;
  let i = 0;
  while (i < amounts.length) {
    //@ invariant 0 <= i && i <= amounts.length
    //@ invariant total >= 0
    //@ invariant forall(k, 0 <= k && k < i ==> total >= amounts[k])
    //@ decreases amounts.length - i
    total = total + amounts[i];
    i += 1;
  }
  return total;
}

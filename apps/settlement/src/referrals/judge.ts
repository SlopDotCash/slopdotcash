//@ backend dafny
// spec/settlement/referralAccrual.md, "A complete immutable source snapshot is filed in ordinal-month order"; spec/settlement/referralAccrual.md, "Filed records, first-use wallet pins and exact roots commit atomically"
import type { AccrualOutcome } from "../../gen/settlement__referralAccrual.ts";

export type StoredOutcome = "accrued" | "project_cap" | "pool_cap" | "window_closed" | "held" | "referrer_excluded" | "asset_not_eligible";

/** @throws {never} */
//@ pure
export function storedOutcome(outcome: AccrualOutcome): StoredOutcome {
  //@ ensures (outcome === "Accrued") === (\result === "accrued")
  //@ ensures (outcome === "ProjectCap") === (\result === "project_cap")
  //@ ensures (outcome === "PoolCap") === (\result === "pool_cap")
  //@ ensures (outcome === "WindowClosed") === (\result === "window_closed")
  //@ ensures (outcome === "Held") === (\result === "held")
  //@ ensures (outcome === "ReferrerExcluded") === (\result === "referrer_excluded")
  //@ ensures (outcome === "AssetNotEligible") === (\result === "asset_not_eligible")
  return outcome === "Accrued" ? "accrued"
    : outcome === "ProjectCap" ? "project_cap"
    : outcome === "PoolCap" ? "pool_cap"
    : outcome === "WindowClosed" ? "window_closed"
    : outcome === "Held" ? "held"
    : outcome === "ReferrerExcluded" ? "referrer_excluded"
    : "asset_not_eligible";
}

/** @throws {never} */
export function modelOutcome(stored: StoredOutcome): AccrualOutcome {
  //@ ensures storedOutcome(\result) === stored
  return stored === "accrued" ? "Accrued"
    : stored === "project_cap" ? "ProjectCap"
    : stored === "pool_cap" ? "PoolCap"
    : stored === "window_closed" ? "WindowClosed"
    : stored === "held" ? "Held"
    : stored === "referrer_excluded" ? "ReferrerExcluded"
    : "AssetNotEligible";
}

/** @throws {never} */
//@ pure
export function countsTowardTotals(stored: StoredOutcome): boolean {
  //@ ensures \result <==> (stored === "accrued" || stored === "project_cap" || stored === "pool_cap")
  return stored === "accrued" || stored === "project_cap" || stored === "pool_cap";
}

/** @throws {never} */
export function rowConsistent(stored: StoredOutcome, computed: bigint, accrued: bigint): boolean {
  //@ ensures \result <==> (0 <= accrued && accrued <= computed && (countsTowardTotals(stored) || computed === 0) && (stored !== "accrued" || accrued === computed))
  return 0n <= accrued && accrued <= computed && (countsTowardTotals(stored) || computed === 0n) && (stored !== "accrued" || accrued === computed);
}

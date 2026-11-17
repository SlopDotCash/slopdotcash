//@ backend dafny
// spec/settlement/referralPublication.md, "The claims read answers only the signed-in account's cached view of the active root and says when it is stale"; spec/settlement/referralPublication.md, "History, native holds and cumulative claims remain bounded"

export type ClaimsStatus = "Hidden" | "Unknown" | "Failed" | "Stale" | "Ready";

export interface ClaimsEvidence {
  posted: boolean;
  cacheKnown: boolean;
  rootFiled: boolean;
  accrued: bigint;
  claimed: bigint;
  leaf: bigint;
  distributorPaused: boolean;
  stale: boolean;
}

export interface ClaimsView {
  status: ClaimsStatus;
  claimable: bigint;
  pending: bigint;
}

export interface EpochWindow {
  voided: boolean;
  claimableAt: number;
}

/** @throws {never} */
//@ pure
export function claimableAmount(leaf: bigint, claimed: bigint, distributorPaused: boolean): bigint {
  //@ ensures \result >= 0
  //@ ensures distributorPaused ==> \result === 0
  //@ ensures !distributorPaused && leaf >= claimed ==> \result === leaf - claimed
  //@ ensures leaf < claimed ==> \result === 0
  if (distributorPaused || leaf < claimed) return 0n;
  return leaf - claimed;
}

/** @throws {never} */
export function claimsView(evidence: ClaimsEvidence): ClaimsView {
  //@ requires evidence.accrued >= 0 && evidence.claimed >= 0 && evidence.leaf >= 0
  //@ ensures !evidence.posted ==> \result.status === "Hidden"
  //@ ensures evidence.posted && !evidence.cacheKnown ==> \result.status === "Unknown"
  //@ ensures \result.status === "Hidden" ==> !evidence.posted
  //@ ensures \result.status === "Unknown" ==> evidence.posted && !evidence.cacheKnown
  //@ ensures (\result.status === "Ready" || \result.status === "Stale") ==> evidence.posted && evidence.cacheKnown && evidence.rootFiled && evidence.claimed + claimableAmount(evidence.leaf, evidence.claimed, evidence.distributorPaused) <= evidence.accrued
  //@ ensures \result.status === "Stale" ==> evidence.stale
  //@ ensures \result.status === "Ready" ==> !evidence.stale && \result.claimable === claimableAmount(evidence.leaf, evidence.claimed, evidence.distributorPaused) && \result.pending === evidence.accrued - evidence.claimed - \result.claimable && \result.pending >= 0
  //@ ensures \result.status !== "Ready" ==> \result.claimable === 0 && \result.pending === 0
  //@ ensures evidence.posted && evidence.cacheKnown && (!evidence.rootFiled || evidence.claimed + claimableAmount(evidence.leaf, evidence.claimed, evidence.distributorPaused) > evidence.accrued) ==> \result.status === "Failed"
  if (!evidence.posted) return { status: "Hidden", claimable: 0n, pending: 0n };
  if (!evidence.cacheKnown) return { status: "Unknown", claimable: 0n, pending: 0n };
  const claimable = claimableAmount(evidence.leaf, evidence.claimed, evidence.distributorPaused);
  if (!evidence.rootFiled || evidence.claimed + claimable > evidence.accrued) return { status: "Failed", claimable: 0n, pending: 0n };
  if (evidence.stale) return { status: "Stale", claimable: 0n, pending: 0n };
  return { status: "Ready", claimable, pending: evidence.accrued - evidence.claimed - claimable };
}

/** @throws {never} */
//@ pure
export function epochClaimable(epoch: EpochWindow, blockTime: number, pauseCutoff: boolean, pauseAt: number): boolean {
  //@ ensures \result <==> !epoch.voided && epoch.claimableAt <= blockTime && !(pauseCutoff && epoch.claimableAt > pauseAt)
  return !epoch.voided && epoch.claimableAt <= blockTime && !(pauseCutoff && epoch.claimableAt > pauseAt);
}

/** @throws {never} */
export function activeEpochIndex(epochs: EpochWindow[], blockTime: number, pauseCutoff: boolean, pauseAt: number): number {
  //@ ensures -1 <= \result && \result < epochs.length
  //@ ensures \result >= 0 ==> epochClaimable(epochs[\result], blockTime, pauseCutoff, pauseAt)
  //@ ensures forall(k, \result < k && k < epochs.length ==> !epochClaimable(epochs[k], blockTime, pauseCutoff, pauseAt))
  let i = epochs.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= epochs.length
    //@ invariant forall(k, i <= k && k < epochs.length ==> !epochClaimable(epochs[k], blockTime, pauseCutoff, pauseAt))
    //@ decreases i
    i = i - 1;
    if (epochClaimable(epochs[i], blockTime, pauseCutoff, pauseAt)) return i;
  }
  return -1;
}

/** @throws {never} */
export function pendingWindowShown(latestVoided: boolean, latestActive: boolean, paused: boolean): boolean {
  //@ ensures \result <==> !latestVoided && !latestActive && !paused
  return !latestVoided && !latestActive && !paused;
}

/** @throws {never} */
export function ageSeconds(nowMillis: bigint, thenMillis: bigint): bigint {
  //@ ensures \result >= 0
  //@ ensures nowMillis - thenMillis <= 0 ==> \result === 0
  //@ ensures nowMillis - thenMillis > 0 ==> \result * 1000 >= nowMillis - thenMillis && (\result - 1) * 1000 < nowMillis - thenMillis
  const elapsed = nowMillis - thenMillis;
  if (elapsed <= 0n) return 0n;
  return (elapsed + 999n) / 1000n;
}

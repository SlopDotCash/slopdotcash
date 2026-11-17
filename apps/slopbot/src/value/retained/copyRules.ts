//@ backend dafny
// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"

export interface CarrierFacts {
  sameRepository: boolean;
  samePull: boolean;
  merged: boolean;
  mergeCommit: boolean;
  humanMerger: boolean;
  sharedPath: boolean;
}

export interface AcknowledgementFacts {
  reopen: boolean;
  retainedSubset: boolean;
  mergerAcknowledged: boolean;
  octoberRebase: boolean;
  linkedCopy: boolean;
}

export type Admission = { kind: "excluded" } | { kind: "acknowledged" } | { kind: "linkedOnly" };

export type PriorBinding = { kind: "free" } | { kind: "kept" } | { kind: "replaced" } | { kind: "contested" };

export interface FileMatches {
  matches: number;
  octoberOriginalCredit: boolean;
  acceptedSubset: boolean;
  prior: PriorBinding;
}

export type FileBinding = { kind: "skip" } | { kind: "unmatched" } | { kind: "ambiguous" } | { kind: "bind" } | { kind: "competing" };

/** @throws {never} */
export function sameSourceCarrier(carrier: CarrierFacts): boolean {
  //@ ensures \result <==> (carrier.sameRepository && !carrier.samePull && carrier.merged && carrier.mergeCommit && carrier.humanMerger && carrier.sharedPath)
  return carrier.sameRepository && !carrier.samePull && carrier.merged && carrier.mergeCommit && carrier.humanMerger && carrier.sharedPath;
}

/** @throws {never} */
export function admission(proof: AcknowledgementFacts): Admission {
  //@ ensures \result.kind !== "excluded" <==> (proof.reopen || proof.retainedSubset || proof.mergerAcknowledged || proof.octoberRebase || proof.linkedCopy)
  //@ ensures \result.kind === "acknowledged" <==> (proof.reopen || proof.retainedSubset || proof.mergerAcknowledged || proof.octoberRebase)
  //@ ensures \result.kind === "linkedOnly" ==> proof.linkedCopy
  if (proof.reopen || proof.retainedSubset || proof.mergerAcknowledged || proof.octoberRebase) return { kind: "acknowledged" };
  if (proof.linkedCopy) return { kind: "linkedOnly" };
  return { kind: "excluded" };
}

/** @throws {never} */
export function fileBinding(file: FileMatches): FileBinding {
  //@ requires file.matches >= 0
  //@ requires file.matches !== 1 ==> file.prior.kind === "free"
  //@ ensures \result.kind === "bind" <==> (file.matches === 1 && (file.prior.kind === "free" || file.prior.kind === "replaced"))
  //@ ensures \result.kind === "competing" <==> (file.matches === 1 && file.prior.kind === "contested")
  //@ ensures \result.kind === "skip" <==> ((file.matches === 0 && file.octoberOriginalCredit) || (file.matches === 1 && file.prior.kind === "kept"))
  //@ ensures \result.kind === "unmatched" <==> (file.matches === 0 && !file.octoberOriginalCredit && file.acceptedSubset)
  //@ ensures \result.kind === "ambiguous" <==> (file.matches > 1 || (file.matches === 0 && !file.octoberOriginalCredit && !file.acceptedSubset))
  if (file.matches === 0 && file.octoberOriginalCredit) return { kind: "skip" };
  if (file.matches === 0 && file.acceptedSubset) return { kind: "unmatched" };
  if (file.matches !== 1) return { kind: "ambiguous" };
  if (file.prior.kind === "kept") return { kind: "skip" };
  if (file.prior.kind === "contested") return { kind: "competing" };
  return { kind: "bind" };
}

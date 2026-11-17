//@ backend dafny
// spec/security/admission.md, "Synthesis decides the repository result and confirmed malice needs trusted evidence"; spec/security/admission.md, "A reused clean result cites one original clean scan of the same repository and commit"

export interface ReuseEvidence {
  readonly inputManifestSha256: string;
  readonly sourceInventorySha256: string | null;
  readonly templateSha256: string;
  readonly hasExecution: boolean;
  readonly artifactCount: number;
  readonly policyVersion: string;
  readonly runId: string;
  readonly reportSha256: string;
}

/** @throws {never} */
//@ pure
export function reusableInventory(evidence: ReuseEvidence): string | null {
  //@ ensures evidence.sourceInventorySha256 !== null ==> \result === evidence.sourceInventorySha256
  //@ ensures evidence.sourceInventorySha256 === null && !evidence.hasExecution && evidence.artifactCount === 0 ==> \result === evidence.inputManifestSha256
  //@ ensures evidence.sourceInventorySha256 === null && (evidence.hasExecution || evidence.artifactCount !== 0) ==> \result === null
  if (evidence.sourceInventorySha256 !== null) return evidence.sourceInventorySha256;
  return !evidence.hasExecution && evidence.artifactCount === 0 ? evidence.inputManifestSha256 : null;
}

/** @throws {never} */
//@ pure
export function sameEvidence(prior: ReuseEvidence, candidate: ReuseEvidence, priorRepository: string, candidateRepository: string): boolean {
  //@ ensures \result <==> priorRepository === candidateRepository && prior.inputManifestSha256 === candidate.inputManifestSha256 && reusableInventory(prior) !== null && reusableInventory(prior) === reusableInventory(candidate) && prior.templateSha256 === candidate.templateSha256 && prior.policyVersion === candidate.policyVersion && prior.runId === candidate.runId && prior.reportSha256 === candidate.reportSha256
  //@ ensures \result ==> prior.inputManifestSha256 === candidate.inputManifestSha256 && prior.templateSha256 === candidate.templateSha256 && prior.policyVersion === candidate.policyVersion && prior.runId === candidate.runId && prior.reportSha256 === candidate.reportSha256
  //@ ensures \result ==> reusableInventory(candidate) !== null
  return priorRepository === candidateRepository
    && prior.inputManifestSha256 === candidate.inputManifestSha256
    && reusableInventory(prior) !== null
    && reusableInventory(prior) === reusableInventory(candidate)
    && prior.templateSha256 === candidate.templateSha256
    && prior.policyVersion === candidate.policyVersion
    && prior.runId === candidate.runId
    && prior.reportSha256 === candidate.reportSha256;
}

/** @throws {never} */
export function allAre(states: string[], wanted: string): boolean {
  //@ ensures \result <==> forall(k, 0 <= k && k < states.length ==> states[k] === wanted)
  let i = 0;
  while (i < states.length) {
    //@ invariant 0 <= i && i <= states.length
    //@ invariant forall(k, 0 <= k && k < i ==> states[k] === wanted)
    //@ decreases states.length - i
    if (states[i] !== wanted) return false;
    i += 1;
  }
  return true;
}

/** @throws {never} */
export function noneAre(states: string[], unwanted: string): boolean {
  //@ ensures \result <==> forall(k, 0 <= k && k < states.length ==> states[k] !== unwanted)
  let i = 0;
  while (i < states.length) {
    //@ invariant 0 <= i && i <= states.length
    //@ invariant forall(k, 0 <= k && k < i ==> states[k] !== unwanted)
    //@ decreases states.length - i
    if (states[i] === unwanted) return false;
    i += 1;
  }
  return true;
}

/** @throws {never} */
export function dispositionProven(disposition: string, confirmed: boolean, surfaces: string[], checks: string[]): boolean {
  //@ ensures disposition === "malicious" ==> (\result <==> confirmed)
  //@ ensures disposition === "malicious" && !confirmed ==> !\result
  //@ ensures disposition === "incomplete" ==> (\result <==> !confirmed)
  //@ ensures disposition === "clean" ==> (\result <==> !confirmed && forall(k, 0 <= k && k < surfaces.length ==> surfaces[k] === "complete") && forall(k, 0 <= k && k < checks.length ==> checks[k] !== "not-run"))
  //@ ensures disposition !== "clean" && disposition !== "incomplete" && disposition !== "malicious" ==> !\result
  if (disposition === "malicious") return confirmed;
  if (confirmed) return false;
  if (disposition === "incomplete") return true;
  if (disposition !== "clean") return false;
  const complete = allAre(surfaces, "complete");
  const run = noneAre(checks, "not-run");
  return complete && run;
}

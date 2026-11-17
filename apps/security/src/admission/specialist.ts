//@ backend dafny
// spec/security/admission.md, "The primary review decides and an ambiguous or high-risk finding needs the specialist"

/** @throws {never} */
export function scanNeedsSpecialist(verdict: string, risk: string, flaggedThreat: boolean, seriousFinding: boolean, unreleasedArtifact: boolean): boolean {
  //@ ensures \result <==> (verdict !== "no-findings" || risk !== "low" || flaggedThreat || seriousFinding || unreleasedArtifact)
  //@ ensures (verdict === "no-findings" && risk === "low" && !flaggedThreat && !seriousFinding && !unreleasedArtifact) ==> !\result
  return verdict !== "no-findings" || risk !== "low" || flaggedThreat || seriousFinding || unreleasedArtifact;
}

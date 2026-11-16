/** Pure policy decisions; callers retain authority, storage and evidence checks. */

export function closureAllowed(
  itemKind: string,
  exemption: string,
  member: boolean,
  recordedSkillRun: boolean,
): boolean {
  //@ verify
  //@ ensures \result <==> itemKind === "pull_request" && exemption === "not-exempt" && member && recordedSkillRun
  //@ ensures exemption !== "not-exempt" || !member || !recordedSkillRun ==> !\result
  return (
    itemKind === "pull_request" &&
    exemption === "not-exempt" &&
    member &&
    recordedSkillRun
  );
}

/** Published penalty thirds; all other categories carry no debit. */
export function penaltyDebit(category: string): number {
  //@ verify
  //@ ensures category === "spam" ==> \result === 3
  //@ ensures category === "scam" ==> \result === 24
  //@ ensures category === "busywork" || category === "gaming" ==> \result === 1
  //@ ensures category !== "spam" && category !== "scam" && category !== "busywork" && category !== "gaming" ==> \result === 0
  //@ ensures \result >= 0 && \result <= 24
  if (category === "spam") return 3;
  if (category === "scam") return 24;
  if (category === "busywork" || category === "gaming") return 1;
  return 0;
}

export function scanNeedsSpecialist(
  verdict: string | null,
  risk: string | null,
  flaggedThreat: boolean,
  seriousFinding: boolean,
  unreleasedArtifact: boolean,
): boolean {
  //@ verify
  //@ ensures \result <==> verdict !== "no-findings" || risk !== "low" || flaggedThreat || seriousFinding || unreleasedArtifact
  //@ ensures verdict === "no-findings" && risk === "low" && !flaggedThreat && !seriousFinding && !unreleasedArtifact ==> !\result
  return (
    verdict !== "no-findings" ||
    risk !== "low" ||
    flaggedThreat ||
    seriousFinding ||
    unreleasedArtifact
  );
}

/** Exact bound for one accrual; a previously exhausted cap gives zero. */
export function cappedReferralAccrual(
  computed: bigint,
  projectRemaining: bigint,
  poolRemaining: bigint,
): bigint {
  //@ verify
  //@ requires computed >= 0n
  //@ ensures \result >= 0n && \result <= computed
  //@ ensures projectRemaining <= 0n || poolRemaining <= 0n ==> \result === 0n
  //@ ensures projectRemaining >= 0n ==> \result <= projectRemaining
  //@ ensures poolRemaining >= 0n ==> \result <= poolRemaining
  //@ ensures computed <= projectRemaining && computed <= poolRemaining ==> \result === computed
  //@ ensures projectRemaining > 0n && poolRemaining > 0n ==> \result === computed || \result === projectRemaining || \result === poolRemaining
  const projectAvailable = projectRemaining > 0n ? projectRemaining : 0n;
  const poolAvailable = poolRemaining > 0n ? poolRemaining : 0n;
  const projectBound =
    computed < projectAvailable ? computed : projectAvailable;
  return projectBound < poolAvailable ? projectBound : poolAvailable;
}

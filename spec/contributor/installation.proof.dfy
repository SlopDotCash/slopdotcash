lemma retain_ensures(i: Installation)
  ensures (inv(i) ==> canRetain(i) ==> alwaysIdentities(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysLocalMatchesActive(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysSuccessHasReadback(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysCandidateVerified(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysCleanupFacts(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysActivationOutput(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysPublishedStage(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysActiveRetained(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysCandidateRetained(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysUncommittedRetainsActive(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> stepRiskEndsInstallation(i, retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> stepCommittedTarget(i, "retain", retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> stepOtherAttemptsUntouched(i, retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> stepWrapperDeathKeepsLock(i, "retain", retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> stepProjectFixed(i, retain(i)))
{
  if inv(i) && canRetain(i) && !retainedVersion(i, i.target) {
    var next := retain(i);
    forall id | id in next.stagedCandidates ensures id in next.workRoots {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.stagedCandidates, id);
    }
  }
}

lemma commit_ensures(i: Installation, relativeLink: bool, atomicRename: bool)
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysIdentities(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysLocalMatchesActive(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysSuccessHasReadback(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysCandidateVerified(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysCleanupFacts(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysActivationOutput(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysPublishedStage(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysActiveRetained(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysCandidateRetained(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> alwaysUncommittedRetainsActive(commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> stepRiskEndsInstallation(i, commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> stepCommittedTarget(i, "commit", commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> stepOtherAttemptsUntouched(i, commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> stepWrapperDeathKeepsLock(i, "commit", commit(i, relativeLink, atomicRename)))
  ensures (inv(i) ==> canCommit(i, relativeLink, atomicRename) ==> stepProjectFixed(i, commit(i, relativeLink, atomicRename)))
{
  if inv(i) && canCommit(i, relativeLink, atomicRename) {
    var next := commit(i, relativeLink, atomicRename);
    forall id | id in next.temporaryLinks ensures 0 < id && id <= next.attempt {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.temporaryLinks, id);
    }
    forall id | id in i.temporaryLinks && id != next.attempt ensures id in next.temporaryLinks {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.temporaryLinks, id);
    }
  }
}

lemma recordFailure_ensures(i: Installation, temporaryLinkRemoved: bool)
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysIdentities(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysLocalMatchesActive(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysSuccessHasReadback(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysCandidateVerified(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysCleanupFacts(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysActivationOutput(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysPublishedStage(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysActiveRetained(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysCandidateRetained(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> alwaysUncommittedRetainsActive(recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> stepRiskEndsInstallation(i, recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> stepCommittedTarget(i, "recordFailure", recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> stepOtherAttemptsUntouched(i, recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> stepWrapperDeathKeepsLock(i, "recordFailure", recordFailure(i, temporaryLinkRemoved)))
  ensures (inv(i) ==> canRecordFailure(i) ==> stepProjectFixed(i, recordFailure(i, temporaryLinkRemoved)))
{
  if inv(i) && canRecordFailure(i) && i.phase.LinkReady? && temporaryLinkRemoved {
    var next := recordFailure(i, temporaryLinkRemoved);
    forall id | id in next.temporaryLinks ensures 0 < id && id <= next.attempt {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.temporaryLinks, id);
    }
    forall id | id in i.temporaryLinks && id != next.attempt ensures id in next.temporaryLinks {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.temporaryLinks, id);
    }
  }
}

lemma cleanup_ensures(i: Installation, succeeds: bool)
  ensures (inv(i) ==> canCleanup(i) ==> alwaysIdentities(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysLocalMatchesActive(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysSuccessHasReadback(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysCandidateVerified(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysCleanupFacts(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysActivationOutput(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysPublishedStage(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysActiveRetained(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysCandidateRetained(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysUncommittedRetainsActive(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> stepRiskEndsInstallation(i, cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> stepCommittedTarget(i, "cleanup", cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> stepOtherAttemptsUntouched(i, cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> stepWrapperDeathKeepsLock(i, "cleanup", cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> stepProjectFixed(i, cleanup(i, succeeds)))
{
  if inv(i) && canCleanup(i) && succeeds {
    var next := cleanup(i, succeeds);
    forall id | id in next.workRoots ensures 0 < id && id <= next.attempt {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.workRoots, id);
    }
    forall id | id in i.workRoots && id != next.attempt ensures id in next.workRoots {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.workRoots, id);
    }
    forall id | id in next.stagedCandidates ensures id in next.workRoots {
      ProofLib.FilterMember((x: int) => x != i.attempt, i.stagedCandidates, id);
      ProofLib.FilterMember((x: int) => x != i.attempt, i.workRoots, id);
    }
  }
}

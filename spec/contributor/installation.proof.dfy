lemma download_ensures(i: Installation, immutableUrl: bool, completeTree: bool)
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysIdentities(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysSuccessHasReadback(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysCandidateVerified(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysCleanupFacts(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysActivationOutput(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysPublishedStage(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysActiveRetained(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysCandidateRetained(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> alwaysUncommittedRetainsActive(download(i, immutableUrl, completeTree)))
  ensures (inv(i) ==> canDownload(i, immutableUrl, completeTree) ==> stepCommittedTarget(i, "download", download(i, immutableUrl, completeTree)))
{
  if inv(i) && canDownload(i, immutableUrl, completeTree) && !i.explicitRollback {
    var next := download(i, immutableUrl, completeTree);
    assert next.workRoots == i.workRoots + [i.attempt];
    assert next.stagedCandidates == i.stagedCandidates + [i.attempt];
    forall id | id in next.stagedCandidates ensures id in next.workRoots {
      if id in i.stagedCandidates { assert id in i.workRoots; }
      else { assert id == i.attempt; }
    }
  }
}

lemma retain_ensures(i: Installation)
  ensures (inv(i) ==> canRetain(i) ==> alwaysIdentities(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysSuccessHasReadback(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysCandidateVerified(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysCleanupFacts(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysActivationOutput(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysPublishedStage(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysActiveRetained(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysCandidateRetained(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> alwaysUncommittedRetainsActive(retain(i)))
  ensures (inv(i) ==> canRetain(i) ==> stepCommittedTarget(i, "retain", retain(i)))
{
  if inv(i) && canRetain(i) && !retainedPair(i, i.template, i.revision) {
    var next := retain(i);
    forall id | id in next.stagedCandidates ensures id in next.workRoots {
      ProofLib.FilterMember((x: int) => x != i.attempt,i.stagedCandidates,id);
      assert id in i.stagedCandidates && id in i.workRoots;
    }
  }
}

lemma cleanup_ensures(i: Installation, succeeds: bool)
  ensures (inv(i) ==> canCleanup(i) ==> alwaysIdentities(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysSuccessHasReadback(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysCandidateVerified(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysCleanupFacts(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysActivationOutput(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysPublishedStage(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysActiveRetained(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysCandidateRetained(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> alwaysUncommittedRetainsActive(cleanup(i, succeeds)))
  ensures (inv(i) ==> canCleanup(i) ==> stepCommittedTarget(i, "cleanup", cleanup(i, succeeds)))
{
  if inv(i) && canCleanup(i) && succeeds {
    var next := cleanup(i, succeeds);
    forall id | id in next.stagedCandidates ensures id in next.workRoots {
      var keeps := (x: int) => x != i.attempt;
      ProofLib.FilterMember(keeps,i.stagedCandidates,id);
      assert id in i.workRoots && keeps(id);
      ProofLib.FilterMember(keeps,i.workRoots,id);
    }
  }
}

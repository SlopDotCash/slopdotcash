// Filtering pending attempts keeps only attempts that were already below the last issued ID.
lemma confirm_ensures(c: Capacity, closeEvent: CloseEvidence)
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> alwaysCapInRange(confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> alwaysNoValueAppealReversals(confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> alwaysAttemptsBelowLast(confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> alwaysCloseTimesKnown(confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> stepTimeMonotone(c, confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> stepTimeNeverFreesPending(c, "confirm", confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> stepFactsAppendOnly(c, confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> stepAttemptIdsNeverReused(c, confirm(c, closeEvent)))
  ensures (inv(c) ==> canConfirm(c, closeEvent) ==> stepReserveWithinCapacity(c, "confirm", confirm(c, closeEvent)))
{
  if inv(c) && canConfirm(c, closeEvent) {
    ConfirmShape(c, closeEvent);
    PendingFiltered(c, closeEvent.attemptId);
  }
}

lemma reject_ensures(c: Capacity, githubRefusal: GithubRefusal)
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> alwaysCapInRange(reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> alwaysNoValueAppealReversals(reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> alwaysAttemptsBelowLast(reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> alwaysCloseTimesKnown(reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> stepTimeMonotone(c, reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> stepTimeNeverFreesPending(c, "reject", reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> stepFactsAppendOnly(c, reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> stepAttemptIdsNeverReused(c, reject(c, githubRefusal)))
  ensures (inv(c) ==> canReject(c, githubRefusal) ==> stepReserveWithinCapacity(c, "reject", reject(c, githubRefusal)))
{
  if inv(c) && canReject(c, githubRefusal) {
    RejectShape(c, githubRefusal);
    PendingFiltered(c, githubRefusal.attemptId);
  }
}

lemma ConfirmShape(c: Capacity, closeEvent: CloseEvidence)
  ensures confirm(c, closeEvent).pending == ProofLib.Filter((a: Attempt) => (a.attemptId != closeEvent.attemptId), c.pending)
{
}

lemma RejectShape(c: Capacity, githubRefusal: GithubRefusal)
  ensures reject(c, githubRefusal).pending == ProofLib.Filter((a: Attempt) => (a.attemptId != githubRefusal.attemptId), c.pending)
{
}

lemma PendingFiltered(c: Capacity, attemptId: int)
  ensures forall a :: a in ProofLib.Filter((a: Attempt) => (a.attemptId != attemptId), c.pending) ==> a in c.pending
{
  forall a | a in ProofLib.Filter((a: Attempt) => (a.attemptId != attemptId), c.pending)
    ensures a in c.pending
  {
    ProofLib.FilterMember((a: Attempt) => (a.attemptId != attemptId), c.pending, a);
  }
}

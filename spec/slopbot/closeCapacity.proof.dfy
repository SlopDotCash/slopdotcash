// Filtering pending attempts keeps only attempts that were already below the last issued ID.
lemma confirm_ensures(c: Capacity, attemptId: int, closedAt: int)
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> alwaysCapInRange(confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> alwaysAttemptsBelowLast(confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> alwaysCloseTimesKnown(confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> stepTimeMonotone(c, confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> stepTimeNeverFreesPending(c, "confirm", confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> stepFactsAppendOnly(c, confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> stepAttemptIdsNeverReused(c, confirm(c, attemptId, closedAt)))
  ensures (inv(c) ==> canConfirm(c, attemptId, closedAt) ==> stepReserveWithinCapacity(c, "confirm", confirm(c, attemptId, closedAt)))
{
  if inv(c) && canConfirm(c, attemptId, closedAt) {
    ConfirmShape(c, attemptId, closedAt);
    PendingFiltered(c, attemptId);
  }
}

lemma reject_ensures(c: Capacity, attemptId: int)
  ensures (inv(c) ==> canReject(c, attemptId) ==> alwaysCapInRange(reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> alwaysAttemptsBelowLast(reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> alwaysCloseTimesKnown(reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> stepTimeMonotone(c, reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> stepTimeNeverFreesPending(c, "reject", reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> stepFactsAppendOnly(c, reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> stepAttemptIdsNeverReused(c, reject(c, attemptId)))
  ensures (inv(c) ==> canReject(c, attemptId) ==> stepReserveWithinCapacity(c, "reject", reject(c, attemptId)))
{
  if inv(c) && canReject(c, attemptId) {
    RejectShape(c, attemptId);
    PendingFiltered(c, attemptId);
  }
}

lemma ConfirmShape(c: Capacity, attemptId: int, closedAt: int)
  ensures confirm(c, attemptId, closedAt).pending == ProofLib.Filter((a: Attempt) => (a.attemptId != attemptId), c.pending)
{
}

lemma RejectShape(c: Capacity, attemptId: int)
  ensures reject(c, attemptId).pending == ProofLib.Filter((a: Attempt) => (a.attemptId != attemptId), c.pending)
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

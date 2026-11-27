lemma AttemptLookup(v: ValueInference, attemptId: int)
  ensures attempt(v, attemptId) == noAttempt || (attempt(v, attemptId) in v.attempts && attempt(v, attemptId).id == attemptId)
{
  var matches := ProofLib.Filter((a: Attempt) => (a.id == attemptId), v.attempts);
  if |matches| > 0 {
    ProofLib.FilterMember((a: Attempt) => (a.id == attemptId), v.attempts, matches[0]);
  }
}

lemma ReserveOccupied(v: ValueInference, attemptId: int, otherUsed: int, otherHeld: int, otherUnbounded: bool)
  ensures reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded).occupied ==
    v.occupied + ProofLib.Filter((set_x: int) => !((set_x in v.occupied)), [attemptId])
{
}

lemma OccupiedWith(occ: seq<int>, attemptId: int)
  ensures var next := occ + ProofLib.Filter((set_x: int) => !((set_x in occ)), [attemptId]);
    attemptId in next && (forall x :: x in occ ==> x in next)
{
  ProofLib.FilterMember((set_x: int) => !((set_x in occ)), [attemptId], attemptId);
}

lemma SaveUsageOccupied(v: ValueInference, attemptId: int)
  ensures saveUsage(v, attemptId).occupied ==
    (if chargeFree(attempt(v, attemptId).(usageSaved := true)) then ProofLib.Filter((set_x: int) => !((set_x in [attemptId])), v.occupied) else v.occupied)
{
}

lemma ReconcileOccupied(v: ValueInference, attemptId: int)
  ensures reconcile(v, attemptId).occupied ==
    (if |attempt(v, attemptId).allCalls| == 0 then ProofLib.Filter((set_x: int) => !((set_x in [attemptId])), v.occupied) else v.occupied)
{
}

lemma OccupiedWithout(occ: seq<int>, attemptId: int)
  ensures var next := ProofLib.Filter((set_x: int) => !((set_x in [attemptId])), occ);
    forall x :: x in occ && x != attemptId ==> x in next
{
  var filtered := ProofLib.Filter((set_x: int) => !((set_x in [attemptId])), occ);
  forall x | x in occ && x != attemptId
    ensures x in filtered
  {
    ProofLib.FilterMember((set_x: int) => !((set_x in [attemptId])), occ, x);
  }
}

lemma reserve_ensures(v: ValueInference, attemptId: int, otherUsed: int, otherHeld: int, otherUnbounded: bool)
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> alwaysInterruptedCallKeepsItsSlot(reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> alwaysCallsAreFree(reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> alwaysRetainedBandIsValid(reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> alwaysPublicationUsesRetained(reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> alwaysAttemptLimit(reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> stepRetainResult(v, reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
  ensures (inv(v) ==> canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) ==> stepRetainPublication(v, reserve(v, attemptId, otherUsed, otherHeld, otherUnbounded)))
{
  if inv(v) && canReserve(v, attemptId, otherUsed, otherHeld, otherUnbounded) {
    AttemptLookup(v, attemptId);
    ReserveOccupied(v, attemptId, otherUsed, otherHeld, otherUnbounded);
    OccupiedWith(v.occupied, attemptId);
  }
}

lemma endWithoutCall_ensures(v: ValueInference, attemptId: int)
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> alwaysInterruptedCallKeepsItsSlot(endWithoutCall(v, attemptId)))
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> alwaysCallsAreFree(endWithoutCall(v, attemptId)))
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> alwaysRetainedBandIsValid(endWithoutCall(v, attemptId)))
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> alwaysPublicationUsesRetained(endWithoutCall(v, attemptId)))
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> alwaysAttemptLimit(endWithoutCall(v, attemptId)))
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> stepRetainResult(v, endWithoutCall(v, attemptId)))
  ensures (inv(v) ==> canEndWithoutCall(v, attemptId) ==> stepRetainPublication(v, endWithoutCall(v, attemptId)))
{
  if inv(v) && canEndWithoutCall(v, attemptId) {
    AttemptLookup(v, attemptId);
  }
}

lemma call_ensures(v: ValueInference, attemptId: int)
  ensures (inv(v) ==> canCall(v, attemptId) ==> alwaysInterruptedCallKeepsItsSlot(call(v, attemptId)))
  ensures (inv(v) ==> canCall(v, attemptId) ==> alwaysCallsAreFree(call(v, attemptId)))
  ensures (inv(v) ==> canCall(v, attemptId) ==> alwaysRetainedBandIsValid(call(v, attemptId)))
  ensures (inv(v) ==> canCall(v, attemptId) ==> alwaysPublicationUsesRetained(call(v, attemptId)))
  ensures (inv(v) ==> canCall(v, attemptId) ==> alwaysAttemptLimit(call(v, attemptId)))
  ensures (inv(v) ==> canCall(v, attemptId) ==> stepRetainResult(v, call(v, attemptId)))
  ensures (inv(v) ==> canCall(v, attemptId) ==> stepRetainPublication(v, call(v, attemptId)))
{
  if inv(v) && canCall(v, attemptId) {
    AttemptLookup(v, attemptId);
  }
}

lemma skipUnavailable_ensures(v: ValueInference, attemptId: int, unavailableProvider: Provider, credentialMissing: bool)
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> alwaysInterruptedCallKeepsItsSlot(skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> alwaysCallsAreFree(skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> alwaysRetainedBandIsValid(skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> alwaysPublicationUsesRetained(skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> alwaysAttemptLimit(skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> stepRetainResult(v, skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
  ensures (inv(v) ==> canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) ==> stepRetainPublication(v, skipUnavailable(v, attemptId, unavailableProvider, credentialMissing)))
{
  if inv(v) && canSkipUnavailable(v, attemptId, unavailableProvider, credentialMissing) {
    AttemptLookup(v, attemptId);
  }
}

lemma recordCall_ensures(v: ValueInference, attemptId: int, charge: Charge)
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> alwaysInterruptedCallKeepsItsSlot(recordCall(v, attemptId, charge)))
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> alwaysCallsAreFree(recordCall(v, attemptId, charge)))
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> alwaysRetainedBandIsValid(recordCall(v, attemptId, charge)))
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> alwaysPublicationUsesRetained(recordCall(v, attemptId, charge)))
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> alwaysAttemptLimit(recordCall(v, attemptId, charge)))
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> stepRetainResult(v, recordCall(v, attemptId, charge)))
  ensures (inv(v) ==> canRecordCall(v, attemptId, charge) ==> stepRetainPublication(v, recordCall(v, attemptId, charge)))
{
  if inv(v) && canRecordCall(v, attemptId, charge) {
    AttemptLookup(v, attemptId);
  }
}

lemma complete_ensures(v: ValueInference, attemptId: int)
  ensures (inv(v) ==> canComplete(v, attemptId) ==> alwaysInterruptedCallKeepsItsSlot(complete(v, attemptId)))
  ensures (inv(v) ==> canComplete(v, attemptId) ==> alwaysCallsAreFree(complete(v, attemptId)))
  ensures (inv(v) ==> canComplete(v, attemptId) ==> alwaysRetainedBandIsValid(complete(v, attemptId)))
  ensures (inv(v) ==> canComplete(v, attemptId) ==> alwaysPublicationUsesRetained(complete(v, attemptId)))
  ensures (inv(v) ==> canComplete(v, attemptId) ==> alwaysAttemptLimit(complete(v, attemptId)))
  ensures (inv(v) ==> canComplete(v, attemptId) ==> stepRetainResult(v, complete(v, attemptId)))
  ensures (inv(v) ==> canComplete(v, attemptId) ==> stepRetainPublication(v, complete(v, attemptId)))
{
  if inv(v) && canComplete(v, attemptId) {
    AttemptLookup(v, attemptId);
  }
}

lemma retain_ensures(v: ValueInference, attemptId: int)
  ensures (inv(v) ==> canRetain(v, attemptId) ==> alwaysInterruptedCallKeepsItsSlot(retain(v, attemptId)))
  ensures (inv(v) ==> canRetain(v, attemptId) ==> alwaysCallsAreFree(retain(v, attemptId)))
  ensures (inv(v) ==> canRetain(v, attemptId) ==> alwaysRetainedBandIsValid(retain(v, attemptId)))
  ensures (inv(v) ==> canRetain(v, attemptId) ==> alwaysPublicationUsesRetained(retain(v, attemptId)))
  ensures (inv(v) ==> canRetain(v, attemptId) ==> alwaysAttemptLimit(retain(v, attemptId)))
  ensures (inv(v) ==> canRetain(v, attemptId) ==> stepRetainResult(v, retain(v, attemptId)))
  ensures (inv(v) ==> canRetain(v, attemptId) ==> stepRetainPublication(v, retain(v, attemptId)))
{
  if inv(v) && canRetain(v, attemptId) {
    AttemptLookup(v, attemptId);
    var a := attempt(v, attemptId);
    assert lastCharge(a) in a.allCalls;
  }
}

lemma saveUsage_ensures(v: ValueInference, attemptId: int)
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> alwaysInterruptedCallKeepsItsSlot(saveUsage(v, attemptId)))
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> alwaysCallsAreFree(saveUsage(v, attemptId)))
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> alwaysRetainedBandIsValid(saveUsage(v, attemptId)))
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> alwaysPublicationUsesRetained(saveUsage(v, attemptId)))
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> alwaysAttemptLimit(saveUsage(v, attemptId)))
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> stepRetainResult(v, saveUsage(v, attemptId)))
  ensures (inv(v) ==> canSaveUsage(v, attemptId) ==> stepRetainPublication(v, saveUsage(v, attemptId)))
{
  if inv(v) && canSaveUsage(v, attemptId) {
    AttemptLookup(v, attemptId);
    SaveUsageOccupied(v, attemptId);
    OccupiedWithout(v.occupied, attemptId);
  }
}

lemma reconcile_ensures(v: ValueInference, attemptId: int)
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> alwaysInterruptedCallKeepsItsSlot(reconcile(v, attemptId)))
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> alwaysCallsAreFree(reconcile(v, attemptId)))
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> alwaysRetainedBandIsValid(reconcile(v, attemptId)))
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> alwaysPublicationUsesRetained(reconcile(v, attemptId)))
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> alwaysAttemptLimit(reconcile(v, attemptId)))
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> stepRetainResult(v, reconcile(v, attemptId)))
  ensures (inv(v) ==> canReconcile(v, attemptId) ==> stepRetainPublication(v, reconcile(v, attemptId)))
{
  if inv(v) && canReconcile(v, attemptId) {
    AttemptLookup(v, attemptId);
    ReconcileOccupied(v, attemptId);
    OccupiedWithout(v.occupied, attemptId);
  }
}

// Closure marks every unconsumed verification cancelled, so none is pending.
lemma lawClosureWithdrawsEverything_ensures(e: Enrollment, now: int)
  ensures (lawClosureWithdrawsEverything(e, now) == true)
{
  var xs := e.verifications;
  var ys := closeEnrollment(e).verifications;
  assert |ys| == |xs|;
  forall i | 0 <= i < |ys|
    ensures !pending(ys[i], now)
  {
    assert ys[i] == (if !(xs[i].consumed) then xs[i].(cancelled := true) else xs[i]);
  }
  forall v | v in ys
    ensures !pending(v, now)
  {
    var i :| 0 <= i < |ys| && ys[i] == v;
  }
  assert !(exists v :: v in ys && !(!(pending(v, now))));
}

// An accepted request's key then names exactly the one new verification, so the same request replays and a changed one conflicts.
lemma lawAcceptedRequestThenReplays_ensures(e: Enrollment, now: int, id: int, requestKey: int, address: string, addressKey: string, activity: bool, security: bool, others: int)
  ensures (lawAcceptedRequestThenReplays(e, now, id, requestKey, address, addressKey, activity, security, others) == true)
{
  if requestOutcome(e, now, requestKey, address, addressKey, activity, security, others, true) == RequestOutcome.RequestAccepted {
    OwnAfterRequest(e, now, id, requestKey, address, addressKey, activity, security);
  }
}

lemma lawChangedReplayConflicts_ensures(e: Enrollment, now: int, id: int, requestKey: int, address: string, addressKey: string, activity: bool, security: bool, others: int)
  ensures (lawChangedReplayConflicts(e, now, id, requestKey, address, addressKey, activity, security, others) == true)
{
  if requestOutcome(e, now, requestKey, address, addressKey, activity, security, others, true) == RequestOutcome.RequestAccepted {
    OwnAfterRequest(e, now, id, requestKey, address, addressKey, activity, security);
  }
}

lemma OwnAfterRequest(e: Enrollment, now: int, id: int, requestKey: int, address: string, addressKey: string, activity: bool, security: bool)
  requires |ownByKey(e, requestKey)| == 0
  ensures ownByKey(requestVerification(e, now, id, requestKey, address, addressKey, activity, security), requestKey)
    == [requestVerification(e, now, id, requestKey, address, addressKey, activity, security).verifications[|e.verifications|]]
  ensures requestVerification(e, now, id, requestKey, address, addressKey, activity, security).verifications[|e.verifications|]
    == Verification(id, requestKey, address, addressKey, id, activity, security, VerificationDelivery.Queued, now, (now + verificationLifetime), false, false, 0)
{
  var xs := e.verifications;
  var all := requestVerification(e, now, id, requestKey, address, addressKey, activity, security).verifications;
  var mapped := all[..|xs|];
  var added := all[|xs|];
  assert all == mapped + [added];
  assert |mapped| == |xs|;
  forall i | 0 <= i < |xs|
    ensures mapped[i].requestKey == xs[i].requestKey
  {
  }
  ProofLib.FilterLengthPointwise((v: Verification) => (v.requestKey == requestKey), (v: Verification) => (v.requestKey == requestKey), xs, mapped);
  ProofLib.FilterAppend((v: Verification) => (v.requestKey == requestKey), mapped, added);
}

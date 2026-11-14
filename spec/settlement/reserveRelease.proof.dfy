lemma ownerSign_ensures(r: ReserveRelease, attempt: int, by_: string)
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysSignedIdentity(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysLiveAttemptFresh(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysFinalizedHeight(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysObservedAfterSignature(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysNoSettlementOnRelease(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysWholeRelease(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysBoundApproval(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysUntouchedBalances(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysSettlementHistory(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysOwnerRevision(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysValidAmounts(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> alwaysConserved(ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepAttemptHistoryRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepSignedAttemptRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepOriginalTermsRetained(r, ownerSign(r, attempt, by_)))
  ensures (inv(r) ==> canOwnerSign(r, attempt, by_) ==> stepSettlementHistoryRetained(r, ownerSign(r, attempt, by_)))
{
  if inv(r) && canOwnerSign(r, attempt, by_) {
    RetiredFoldComplement(r.retiredAttempts, attempt, false);
    var signed := ownerSign(r, attempt, by_);
    assert signed.signedAttempt == attempt;
    assert signed.retiredAttempts == r.retiredAttempts;
    assert alwaysLiveAttemptFresh(signed);
  }
}

lemma RetiredFoldComplement(history: seq<RetiredReleaseAttempt>, attempt: int, used: bool)
  ensures Std.Collections.Seq.FoldLeft((used: bool, prior: RetiredReleaseAttempt) => (used || (prior.attempt == attempt)), used, history)
    == !Std.Collections.Seq.FoldLeft((fresh_: bool, prior: RetiredReleaseAttempt) => (fresh_ && (prior.attempt != attempt)), !used, history)
  decreases |history|
{
  if |history| > 0 {
    RetiredFoldComplement(history[1..], attempt, used || history[0].attempt == attempt);
  }
}

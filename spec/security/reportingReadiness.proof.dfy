lemma refresh_ensures(r: Readiness, target: Target, read: Read, attemptedAt: int)
  ensures (inv(r) ==> canRefresh(r, target, read, attemptedAt) ==> alwaysVerifiedNotAfterAttempt(refresh(r, target, read, attemptedAt)))
  ensures (inv(r) ==> canRefresh(r, target, read, attemptedAt) ==> stepAttemptsOnlyAdvance(r, refresh(r, target, read, attemptedAt)))
{
  if inv(r) && canRefresh(r, target, read, attemptedAt) {
    var after := refresh(r, target, read, attemptedAt);
    if observed(r, target.revision, target.repository) {
      assert |after.observations| == |r.observations|;
      forall i | 0 <= i < |r.observations|
        ensures after.observations[i].verifiedAt >= 0 && after.observations[i].verifiedAt <= after.observations[i].attemptedAt
        ensures after.observations[i].revision == r.observations[i].revision && after.observations[i].repository == r.observations[i].repository
        ensures after.observations[i].attemptedAt >= r.observations[i].attemptedAt
        ensures r.observations[i].repositoryId > 0 ==> after.observations[i].repositoryId == r.observations[i].repositoryId
      {
        var o := r.observations[i];
        assert o in r.observations;
      }
      forall o | o in after.observations ensures o.verifiedAt >= 0 && o.verifiedAt <= o.attemptedAt {
        var i :| 0 <= i < |after.observations| && after.observations[i] == o;
      }
      forall b | b in r.observations
        ensures exists a :: (a in after.observations && a.revision == b.revision && a.repository == b.repository
          && a.attemptedAt >= b.attemptedAt && (b.repositoryId > 0 ==> a.repositoryId == b.repositoryId))
      {
        var i :| 0 <= i < |r.observations| && r.observations[i] == b;
        assert after.observations[i] in after.observations;
      }
    } else {
      var added := written(noObservation, target, read, attemptedAt);
      assert after.observations == r.observations + [added];
      forall o | o in after.observations ensures o.verifiedAt >= 0 && o.verifiedAt <= o.attemptedAt {
        if o != added { assert o in r.observations; }
      }
      forall b | b in r.observations
        ensures exists a :: (a in after.observations && a.revision == b.revision && a.repository == b.repository
          && a.attemptedAt >= b.attemptedAt && (b.repositoryId > 0 ==> a.repositoryId == b.repositoryId))
      {
        assert b in after.observations;
      }
    }
  }
}

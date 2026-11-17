lemma enterAcquire_ensures(s: DiscoveryLock, owner: int)
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysOneOwnerAndOneAcquirer(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysClearScanHolds(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysStaleCleanupGuarded(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysAdmittedLease(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysChildOwned(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysCloseObserved(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> alwaysStartupHasHelper(enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> stepContentionChangesNothing(s, "enterAcquire", enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> stepTakeoverOnlyWhenStale(s, enterAcquire(s, owner)))
  ensures (inv(s) ==> canEnterAcquire(s, owner) ==> stepTimeReleasesNothing(s, "enterAcquire", enterAcquire(s, owner)))
{
  if inv(s) && canEnterAcquire(s, owner) {
    var after := enterAcquire(s, owner);
    ProofLib.FilterMember((x: int) => (x != owner), s.waiting, owner);
    forall o | o in after.waiting ensures o in s.waiting {
      ProofLib.FilterMember((x: int) => (x != owner), s.waiting, o);
    }
  }
}

lemma contend_ensures(s: DiscoveryLock, owner: int)
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysOneOwnerAndOneAcquirer(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysClearScanHolds(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysStaleCleanupGuarded(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysAdmittedLease(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysChildOwned(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysCloseObserved(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> alwaysStartupHasHelper(contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> stepContentionChangesNothing(s, "contend", contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> stepTakeoverOnlyWhenStale(s, contend(s, owner)))
  ensures (inv(s) ==> canContend(s, owner) ==> stepTimeReleasesNothing(s, "contend", contend(s, owner)))
{
  if inv(s) && canContend(s, owner) {
    var after := contend(s, owner);
    forall o | o in after.waiting ensures o in s.waiting && o != owner {
      ProofLib.FilterMember((x: int) => (x != owner), s.waiting, o);
    }
  }
}

lemma CleanupReleasedFilter(p: LockPublication, succeeds: bool)
  ensures cleanupReleased(p, succeeds).tombstones == (if succeeds then ProofLib.Filter((t: int) => (t != p.actor), p.tombstones) else p.tombstones)
{
}

lemma cleanupReleased_ensures(p: LockPublication, succeeds: bool)
  ensures (inv(p) ==> canCleanupReleased(p) ==> alwaysRollbackUnpublished(cleanupReleased(p, succeeds)))
  ensures (inv(p) ==> canCleanupReleased(p) ==> alwaysOperationFacts(cleanupReleased(p, succeeds)))
  ensures (inv(p) ==> canCleanupReleased(p) ==> alwaysDiagnostics(cleanupReleased(p, succeeds)))
  ensures (inv(p) ==> canCleanupReleased(p) ==> alwaysHandles(cleanupReleased(p, succeeds)))
  ensures (inv(p) ==> canCleanupReleased(p) ==> stepPublishedNeverReissued(p, cleanupReleased(p, succeeds)))
{
  if inv(p) && canCleanupReleased(p) && succeeds {
    var after := cleanupReleased(p, succeeds);
    CleanupReleasedFilter(p, succeeds);
    ProofLib.FilterMember((t: int) => (t != p.actor), p.tombstones, p.actor);
    assert !(p.actor in after.tombstones);
  }
}

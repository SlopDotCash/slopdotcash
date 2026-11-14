lemma renameRelease_ensures(p: LockPublication, succeeds: bool)
  ensures (inv(p) ==> canRenameRelease(p) ==> alwaysRollbackUnpublished(renameRelease(p, succeeds)))
  ensures (inv(p) ==> canRenameRelease(p) ==> alwaysOperationFacts(renameRelease(p, succeeds)))
  ensures (inv(p) ==> canRenameRelease(p) ==> alwaysDiagnostics(renameRelease(p, succeeds)))
  ensures (inv(p) ==> canRenameRelease(p) ==> alwaysHandles(renameRelease(p, succeeds)))
  ensures (inv(p) ==> canRenameRelease(p) ==> stepPublishedNeverReissued(p, renameRelease(p, succeeds)))
{
  if inv(p) && canRenameRelease(p) {
    if p.actor == 1 {
      assert handleOf(p, 1).published;
    } else {
      assert p.actor == 2;
      assert handleOf(p, 2).published;
    }
  }
}

lemma finishRelease_ensures(p: LockPublication)
  ensures (inv(p) ==> canFinishRelease(p) ==> alwaysRollbackUnpublished(finishRelease(p)))
  ensures (inv(p) ==> canFinishRelease(p) ==> alwaysOperationFacts(finishRelease(p)))
  ensures (inv(p) ==> canFinishRelease(p) ==> alwaysDiagnostics(finishRelease(p)))
  ensures (inv(p) ==> canFinishRelease(p) ==> alwaysHandles(finishRelease(p)))
  ensures (inv(p) ==> canFinishRelease(p) ==> stepPublishedNeverReissued(p, finishRelease(p)))
{
  if inv(p) && canFinishRelease(p) {
    if p.actor == 1 {
      assert handleOf(p, 1).published;
    } else {
      assert p.actor == 2;
      assert handleOf(p, 2).published;
    }
  }
}

lemma dispose_ensures(e: ReviewEpoch, itemId: int, frozenHead: int, currentHead: int)
  ensures (inv(e) ==> canDispose(e, itemId, frozenHead, currentHead) ==> alwaysStaleIsDisposed(dispose(e, itemId, frozenHead, currentHead)))
  ensures (inv(e) ==> canDispose(e, itemId, frozenHead, currentHead) ==> alwaysPermitNeedsFrontier(dispose(e, itemId, frozenHead, currentHead)))
  ensures (inv(e) ==> canDispose(e, itemId, frozenHead, currentHead) ==> stepFrontierFrozen(e, dispose(e, itemId, frozenHead, currentHead)))
{
  if inv(e) && canDispose(e, itemId, frozenHead, currentHead) {
    var next := dispose(e, itemId, frozenHead, currentHead);
    forall i | i in e.items
      ensures exists j :: j in next.items && j.item == i.item && j.head == i.head && j.deferred == i.deferred
    {
      var k :| 0 <= k < |e.items| && e.items[k] == i;
      assert next.items[k] in next.items;
    }
  }
}

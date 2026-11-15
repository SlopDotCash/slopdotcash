// Proof of the queue's terminal-copy rule: replacing the one prior copy keeps every other copy.
lemma PutKeepsOthers(prior: Copy)
  ensures forall c: Copy, q: JobQueue, x: Copy :: x in q.copies && x != prior ==> x in putCopy(prior, c, q).copies
{
  forall c: Copy, q: JobQueue, x: Copy | x in q.copies && x != prior
    ensures x in putCopy(prior, c, q).copies
  {
    var i :| 0 <= i < |q.copies| && q.copies[i] == x;
    assert putCopy(prior, c, q).copies[i] == x;
  }
}

lemma deliver_ensures(q: JobQueue, copyId: int)
  ensures (inv(q) ==> canDeliver(q, copyId) ==> alwaysDurableSentOnlyWhenDue(deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> alwaysDeliveriesBounded(deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> alwaysDeadLetterOnlyAfterRetries(deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> alwaysWaitingHasTime(deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> alwaysQueuedUndelivered(deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> alwaysDurableOnlyForDurableKinds(deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> stepTerminalCopiesStay(q, deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> stepResolutionIsFinal(q, deliver(q, copyId)))
  ensures (inv(q) ==> canDeliver(q, copyId) ==> stepResolutionNeedsAHandledCopy(q, deliver(q, copyId)))
{
  PutKeepsOthers(copyOf(q, copyId));
}

lemma handle_ensures(q: JobQueue, copyId: int, result: HandlerResult, remaining: int)
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> alwaysDurableSentOnlyWhenDue(handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> alwaysDeliveriesBounded(handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> alwaysDeadLetterOnlyAfterRetries(handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> alwaysWaitingHasTime(handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> alwaysQueuedUndelivered(handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> alwaysDurableOnlyForDurableKinds(handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> stepTerminalCopiesStay(q, handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> stepResolutionIsFinal(q, handle(q, copyId, result, remaining)))
  ensures (inv(q) ==> canHandle(q, copyId, result, remaining) ==> stepResolutionNeedsAHandledCopy(q, handle(q, copyId, result, remaining)))
{
  PutKeepsOthers(copyOf(q, copyId));
}

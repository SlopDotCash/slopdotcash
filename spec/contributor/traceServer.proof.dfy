lemma createIntent_ensures(s: TraceServer, by_: int, key: string, digest: string, byteCount: int, contentType: ContentType)
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysRunRow(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysAttachedState(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysIntakeNotFuture(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysIntentsBounded(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysConsumedAttached(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysOneReservation(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysAttachedObject(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysWrittenStored(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysContentAddressed(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysAgentEvents(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepClockMonotone(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepRequestImmutable(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepConsumedStaysConsumed(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepReservationPermanent(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepObjectsPermanent(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepAttachedImmutable(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepFinalizedFrozen(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepEventsAppendOnly(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepBannedAddsNothing(s, createIntent(s, by_, key, digest, byteCount, contentType)))
{
  if inv(s) && canCreateIntent(s, by_, key, digest) {
    var next := createIntent(s, by_, key, digest, byteCount, contentType);
    forall i | i in s.intents && i.consumed ensures i in next.intents {
      var k :| 0 <= k < |s.intents| && s.intents[k] == i;
      assert k < |next.intents|;
      assert next.intents[k] == i;
    }
  }
}

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

lemma writeBytes_ensures(s: TraceServer, key: string, succeeds: bool)
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysRunRow(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysAttachedState(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysIntakeNotFuture(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysIntentsBounded(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysConsumedAttached(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysOneReservation(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysAttachedObject(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysWrittenStored(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysContentAddressed(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> alwaysAgentEvents(writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepClockMonotone(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepRequestImmutable(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepConsumedStaysConsumed(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepReservationPermanent(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepObjectsPermanent(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepAttachedImmutable(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepFinalizedFrozen(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepEventsAppendOnly(s, writeBytes(s, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, key) ==> stepBannedAddsNothing(s, writeBytes(s, key, succeeds)))
{
  if inv(s) && canWriteBytes(s, key) {
    var w :| w in s.puts && w.key == key && w.stage.PutReserved?;
    ProofLib.FilterMember((x: Put) => ((x.key == key) && x.stage.PutReserved?), s.puts, w);
    assert w in Std.Collections.Seq.Filter((x: Put) => ((x.key == key) && x.stage.PutReserved?), s.puts);
    var first := Std.Collections.Seq.Filter((x: Put) => ((x.key == key) && x.stage.PutReserved?), s.puts)[0];
    ProofLib.FilterMember((x: Put) => ((x.key == key) && x.stage.PutReserved?), s.puts, first);
    assert first in s.puts;
    var next := writeBytes(s, key, succeeds);
    forall p | p in next.puts && (p.stage.PutWritten? || p.stage.PutAttached?) ensures p.blob in next.objects {
      var k :| 0 <= k < |next.puts| && next.puts[k] == p;
      assert s.puts[k] in s.puts;
    }
  }
}

lemma attachPut_ensures(s: TraceServer, key: string)
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysRunRow(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysAttachedState(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysIntakeNotFuture(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysIntentsBounded(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysConsumedAttached(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysOneReservation(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysAttachedObject(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysWrittenStored(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysContentAddressed(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysAgentEvents(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepClockMonotone(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepRequestImmutable(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepConsumedStaysConsumed(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepReservationPermanent(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepObjectsPermanent(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepAttachedImmutable(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepFinalizedFrozen(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepEventsAppendOnly(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepBannedAddsNothing(s, attachPut(s, key)))
{
  if inv(s) && canAttachPut(s, key) {
    var w :| w in s.puts && w.key == key && w.stage.PutWritten?;
    ProofLib.FilterMember((x: Put) => ((x.key == key) && x.stage.PutWritten?), s.puts, w);
    assert w in Std.Collections.Seq.Filter((x: Put) => ((x.key == key) && x.stage.PutWritten?), s.puts);
    var first := Std.Collections.Seq.Filter((x: Put) => ((x.key == key) && x.stage.PutWritten?), s.puts)[0];
    ProofLib.FilterMember((x: Put) => ((x.key == key) && x.stage.PutWritten?), s.puts, first);
    assert first in s.puts && first.stage.PutWritten?;
    assert first.blob in s.objects;
    var next := attachPut(s, key);
    forall i | i in s.intents && i.consumed ensures i in next.intents {
      var k :| 0 <= k < |s.intents| && s.intents[k] == i;
      assert next.intents[k] == i;
    }
  }
}

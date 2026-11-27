lemma WriteBytesFilter(s: TraceServer, by_: int, key: string, succeeds: bool)
  ensures writeBytes(s, by_, key, succeeds) == (
    var local_5 := (if ((0 <= 0) && (0 < |ProofLib.Filter((x: Put) => ((x.key == key) && x.stage.PutReserved?), s.puts)|)) then ProofLib.Filter((x: Put) => ((x.key == key) && x.stage.PutReserved?), s.puts)[0] else noPut);
    var local_6 := (exists o :: o in s.objects && ((o.digest == local_5.blob.digest) && (o != local_5.blob)));
    if (succeeds && !(local_6)) then
      s.(objects := (if (local_5.blob in s.objects) then s.objects else (s.objects + [local_5.blob])), puts := (var s_map := s.puts; seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var x := s_map[i_map]; (if ((x.key == key) && x.stage.PutReserved?) then x.(stage := PutStage.PutWritten) else x))), reply := Reply.ReplyNone)
    else
      s.(puts := (var s_map := s.puts; seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var x := s_map[i_map]; (if ((x.key == key) && x.stage.PutReserved?) then x.(stage := PutStage.PutFailed) else x))), reply := Reply.ReplyStorageFailed)
  )
{
}

lemma AttachPutFilter(s: TraceServer, key: string)
  ensures attachPut(s, key) == (
    var local_7 := (if ((0 <= 0) && (0 < |ProofLib.Filter((x: Put) => ((x.key == key) && x.stage.PutWritten?), s.puts)|)) then ProofLib.Filter((x: Put) => ((x.key == key) && x.stage.PutWritten?), s.puts)[0] else noPut);
    var local_8 := (exists i :: i in s.intents && ((((((i.key == key) && !(i.consumed)) && (i.expiresAt > local_7.authorizedAt)) && (i.digest == local_7.blob.digest)) && (i.size == local_7.blob.size)) && (i.contentType == local_7.blob.contentType)));
    var local_9 := (var s_map := s.puts; seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var x := s_map[i_map]; (if ((x.key == key) && x.stage.PutWritten?) then x.(stage := PutStage.PutFailed) else x)));
    if s.banned then
      s.(puts := local_9, reply := Reply.ReplyBanned)
    else
      if ((!(local_8) || s.state.Finalized?) || ((s.attached != "") && (s.attached != local_7.blob.digest))) then
        s.(puts := local_9, reply := Reply.ReplyConflict)
      else
        s.(intents := (var s_map := s.intents; seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var i := s_map[i_map]; (if ((i.key == key) && !(i.consumed)) then i.(consumed := true) else i))), attached := local_7.blob.digest, state := RunState.TraceUploaded, puts := (var s_map := s.puts; seq(|s_map|, i_map requires 0 <= i_map < |s_map| => var x := s_map[i_map]; (if ((x.key == key) && x.stage.PutWritten?) then x.(stage := PutStage.PutAttached) else x))), reply := Reply.ReplyCreated)
  )
{
}

lemma createIntent_ensures(s: TraceServer, by_: int, key: string, digest: string, byteCount: int, contentType: ContentType)
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysRunRow(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysAttachedState(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysIntakeWithinSkew(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysIntentsBounded(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysConsumedAttached(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysActorKeysDisjoint(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysOneReservation(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysAttachedObject(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysWrittenStored(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysContentAddressed(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> alwaysAgentEvents(createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepClockMonotone(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepStandingOnlyFromService(s, "createIntent", createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepRequestImmutable(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepConsumedStaysConsumed(s, createIntent(s, by_, key, digest, byteCount, contentType)))
  ensures (inv(s) ==> canCreateIntent(s, by_, key, digest) ==> stepOtherRunKeysPermanent(s, createIntent(s, by_, key, digest, byteCount, contentType)))
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

lemma writeBytes_ensures(s: TraceServer, by_: int, key: string, succeeds: bool)
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysRunRow(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysAttachedState(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysIntakeWithinSkew(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysIntentsBounded(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysConsumedAttached(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysActorKeysDisjoint(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysOneReservation(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysAttachedObject(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysWrittenStored(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysContentAddressed(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> alwaysAgentEvents(writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepClockMonotone(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepStandingOnlyFromService(s, "writeBytes", writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepRequestImmutable(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepConsumedStaysConsumed(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepOtherRunKeysPermanent(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepReservationPermanent(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepObjectsPermanent(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepAttachedImmutable(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepFinalizedFrozen(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepEventsAppendOnly(s, writeBytes(s, by_, key, succeeds)))
  ensures (inv(s) ==> canWriteBytes(s, by_, key) ==> stepBannedAddsNothing(s, writeBytes(s, by_, key, succeeds)))
{
  if inv(s) && canWriteBytes(s, by_, key) {
    WriteBytesFilter(s, by_, key, succeeds);
    var pred := (x: Put) => ((x.key == key) && x.stage.PutReserved?);
    var filtered := ProofLib.Filter(pred, s.puts);
    var w :| w in s.puts && pred(w);
    var wi :| 0 <= wi < |s.puts| && s.puts[wi] == w;
    ProofLib.FilterNone(pred, s.puts);
    assert |filtered| > 0;
    var p := filtered[0];
    ProofLib.FilterMember(pred, s.puts, p);
    assert p in s.puts;
    assert |s.reservation| == 1;
    assert s.reservation[0] == p.blob;
    assert p.blob.digest != "";
  }
}

lemma attachPut_ensures(s: TraceServer, key: string)
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysRunRow(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysAttachedState(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysIntakeWithinSkew(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysIntentsBounded(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysConsumedAttached(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysActorKeysDisjoint(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysOneReservation(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysAttachedObject(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysWrittenStored(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysContentAddressed(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> alwaysAgentEvents(attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepClockMonotone(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepStandingOnlyFromService(s, "attachPut", attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepRequestImmutable(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepConsumedStaysConsumed(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepOtherRunKeysPermanent(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepReservationPermanent(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepObjectsPermanent(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepAttachedImmutable(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepFinalizedFrozen(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepEventsAppendOnly(s, attachPut(s, key)))
  ensures (inv(s) ==> canAttachPut(s, key) ==> stepBannedAddsNothing(s, attachPut(s, key)))
{
  if inv(s) && canAttachPut(s, key) {
    AttachPutFilter(s, key);
    var pred := (x: Put) => ((x.key == key) && x.stage.PutWritten?);
    var filtered := ProofLib.Filter(pred, s.puts);
    var w :| w in s.puts && pred(w);
    var wi :| 0 <= wi < |s.puts| && s.puts[wi] == w;
    ProofLib.FilterNone(pred, s.puts);
    assert |filtered| > 0;
    var p := filtered[0];
    ProofLib.FilterMember(pred, s.puts, p);
    assert p in s.puts && p.stage.PutWritten?;
    assert p.blob in s.objects;
    assert |s.reservation| == 1 && s.reservation[0] == p.blob;
    var next := attachPut(s, key);
    forall i | i in s.intents && i.consumed ensures i in next.intents {
      var k :| 0 <= k < |s.intents| && s.intents[k] == i;
      assert k < |next.intents|;
      assert next.intents[k] == i;
    }
  }
}

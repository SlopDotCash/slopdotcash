lemma closeCase_ensures(b: Backup, id: int)
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysBackupPrefix(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysCompleteManifest(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysFailedQueueIsNotComplete(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysOneMessageInFlight(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysCyclesInOrder(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRestorePrepared(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRestoredExact(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysNeverLivePrefix(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysAdmissionEvidencePermanent(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysDeletionOnlyBacked(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysReceiptsMatchBytes(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRetentionNeedsRestoration(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysTargetsReservedFresh(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRetiredFullyMarked(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysReceiptsNeedBackedRetiredTargets(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysOnlyOldEntriesRemoved(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepReplayKeepsCursor(b, "closeCase", closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepCycleDaysAdvance(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepCleanupNeverWhileBlocked(b, "closeCase", closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepStoredBytesCreateOnly(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepRetentionFinal(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepFrozenRefusesNewWork(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepTargetsNeverRemoved(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepSettlementsPermanent(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepRetirementNeedsRelease(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepAccessLogKeepsYear(b, closeCase(b, id)))
{
  if inv(b) && canCloseCase(b, id) {
    var after := closeCase(b, id);
    forall o | o in b.objects
      ensures exists a :: a in after.objects && a.id == o.id && a.declared == o.declared && (o.stored > 0 ==> a.stored == o.stored) && (o.marker ==> a.marker)
    {
      var k :| 0 <= k < |b.objects| && b.objects[k] == o;
      assert after.objects[k] in after.objects;
    }
    forall o | o in b.objects && !o.retention.Kept?
      ensures o in after.objects
    {
      var i :| 0 <= i < |b.objects| && b.objects[i] == o;
      assert o.closedDay > 0;
      assert after.objects[i] == o;
    }
  }
}

lemma retain_ensures(b: Backup, id: int)
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysBackupPrefix(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysCompleteManifest(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysFailedQueueIsNotComplete(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysOneMessageInFlight(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysCyclesInOrder(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRestorePrepared(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRestoredExact(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysNeverLivePrefix(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysAdmissionEvidencePermanent(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysDeletionOnlyBacked(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysReceiptsMatchBytes(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRetentionNeedsRestoration(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysTargetsReservedFresh(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRetiredFullyMarked(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysReceiptsNeedBackedRetiredTargets(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysOnlyOldEntriesRemoved(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepReplayKeepsCursor(b, "retain", retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepCycleDaysAdvance(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepCleanupNeverWhileBlocked(b, "retain", retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepStoredBytesCreateOnly(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepRetentionFinal(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepFrozenRefusesNewWork(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepTargetsNeverRemoved(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepSettlementsPermanent(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepRetirementNeedsRelease(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepAccessLogKeepsYear(b, retain(b, id)))
{
  if inv(b) && canRetain(b, id) {
    var after := retain(b, id);
    forall o | o in b.objects
      ensures exists a :: a in after.objects && a.id == o.id && a.declared == o.declared && (o.stored > 0 ==> a.stored == o.stored) && (o.marker ==> a.marker)
    {
      var k :| 0 <= k < |b.objects| && b.objects[k] == o;
      assert after.objects[k] in after.objects;
    }
    forall o | o in b.objects && !o.retention.Kept?
      ensures o in after.objects
    {
      var i :| 0 <= i < |b.objects| && b.objects[i] == o;
      assert !eligible(b, o);
      assert after.objects[i] == o;
    }
  }
}

lemma StartWaitingDays(b: Backup, pages: int, digest: int)
  ensures start(b, pages, digest).waitingDays == ProofLib.Filter((d: int) => (d != nextCycleDay(b)), b.waitingDays)
{
}

lemma start_ensures(b: Backup, pages: int, digest: int)
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysBackupPrefix(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysCompleteManifest(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysFailedQueueIsNotComplete(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysOneMessageInFlight(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysCyclesInOrder(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysRestorePrepared(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysRestoredExact(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysNeverLivePrefix(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysAdmissionEvidencePermanent(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysDeletionOnlyBacked(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysReceiptsMatchBytes(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysRetentionNeedsRestoration(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysTargetsReservedFresh(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysRetiredFullyMarked(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysReceiptsNeedBackedRetiredTargets(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> alwaysOnlyOldEntriesRemoved(start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepReplayKeepsCursor(b, "start", start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepCycleDaysAdvance(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepCleanupNeverWhileBlocked(b, "start", start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepStoredBytesCreateOnly(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepRetentionFinal(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepFrozenRefusesNewWork(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepTargetsNeverRemoved(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepSettlementsPermanent(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepRetirementNeedsRelease(b, start(b, pages, digest)))
  ensures (inv(b) ==> canStart(b, pages, digest) ==> stepAccessLogKeepsYear(b, start(b, pages, digest)))
{
  if inv(b) && canStart(b, pages, digest) {
    var after := start(b, pages, digest);
    StartWaitingDays(b, pages, digest);
    forall d | d in after.waitingDays
      ensures d in b.waitingDays && d != nextCycleDay(b)
    {
      ProofLib.FilterMember((x: int) => (x != nextCycleDay(b)), b.waitingDays, d);
    }
  }
}

lemma lateWrite_ensures(b: Backup, id: int, digest: int)
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysBackupPrefix(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysCompleteManifest(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysFailedQueueIsNotComplete(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysOneMessageInFlight(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysCyclesInOrder(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysRestorePrepared(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysRestoredExact(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysNeverLivePrefix(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysAdmissionEvidencePermanent(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysDeletionOnlyBacked(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysReceiptsMatchBytes(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysRetentionNeedsRestoration(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysTargetsReservedFresh(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysRetiredFullyMarked(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysReceiptsNeedBackedRetiredTargets(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> alwaysOnlyOldEntriesRemoved(lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepReplayKeepsCursor(b, "lateWrite", lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepCycleDaysAdvance(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepCleanupNeverWhileBlocked(b, "lateWrite", lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepStoredBytesCreateOnly(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepRetentionFinal(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepFrozenRefusesNewWork(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepTargetsNeverRemoved(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepSettlementsPermanent(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepRetirementNeedsRelease(b, lateWrite(b, id, digest)))
  ensures (inv(b) ==> canLateWrite(b, id, digest) ==> stepAccessLogKeepsYear(b, lateWrite(b, id, digest)))
{
  if inv(b) && canLateWrite(b, id, digest) {
    var after := lateWrite(b, id, digest);
    forall o | o in b.objects
      ensures exists a :: a in after.objects && a.id == o.id && a.declared == o.declared && (o.stored > 0 ==> a.stored == o.stored) && (o.marker ==> a.marker)
    {
      var k :| 0 <= k < |b.objects| && b.objects[k] == o;
      assert after.objects[k] in after.objects;
    }
    forall o | o in b.objects && !o.retention.Kept?
      ensures o in after.objects
    {
      var i :| 0 <= i < |b.objects| && b.objects[i] == o;
      assert after.objects[i] == o;
    }
  }
}

lemma writeMissingMarker_ensures(b: Backup, id: int)
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysBackupPrefix(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysCompleteManifest(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysFailedQueueIsNotComplete(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysOneMessageInFlight(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysCyclesInOrder(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysRestorePrepared(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysRestoredExact(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysNeverLivePrefix(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysAdmissionEvidencePermanent(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysDeletionOnlyBacked(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysReceiptsMatchBytes(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysRetentionNeedsRestoration(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysTargetsReservedFresh(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysRetiredFullyMarked(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysReceiptsNeedBackedRetiredTargets(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> alwaysOnlyOldEntriesRemoved(writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepReplayKeepsCursor(b, "writeMissingMarker", writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepCycleDaysAdvance(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepCleanupNeverWhileBlocked(b, "writeMissingMarker", writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepStoredBytesCreateOnly(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepRetentionFinal(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepFrozenRefusesNewWork(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepTargetsNeverRemoved(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepSettlementsPermanent(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepRetirementNeedsRelease(b, writeMissingMarker(b, id)))
  ensures (inv(b) ==> canWriteMissingMarker(b, id) ==> stepAccessLogKeepsYear(b, writeMissingMarker(b, id)))
{
  if inv(b) && canWriteMissingMarker(b, id) {
    var after := writeMissingMarker(b, id);
    forall o | o in b.objects
      ensures exists a :: a in after.objects && a.id == o.id && a.declared == o.declared && (o.stored > 0 ==> a.stored == o.stored) && (o.marker ==> a.marker)
    {
      var k :| 0 <= k < |b.objects| && b.objects[k] == o;
      assert after.objects[k] in after.objects;
    }
    forall o | o in b.objects && !o.retention.Kept?
      ensures o in after.objects
    {
      var i :| 0 <= i < |b.objects| && b.objects[i] == o;
      assert after.objects[i] == o;
    }
  }
}

lemma classify_ensures(b: Backup, id: int)
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysBackupPrefix(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysCompleteManifest(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysFailedQueueIsNotComplete(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysOneMessageInFlight(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysCyclesInOrder(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysRestorePrepared(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysRestoredExact(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysNeverLivePrefix(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysAdmissionEvidencePermanent(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysDeletionOnlyBacked(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysReceiptsMatchBytes(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysRetentionNeedsRestoration(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysTargetsReservedFresh(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysRetiredFullyMarked(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysReceiptsNeedBackedRetiredTargets(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> alwaysOnlyOldEntriesRemoved(classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepReplayKeepsCursor(b, "classify", classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepCycleDaysAdvance(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepCleanupNeverWhileBlocked(b, "classify", classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepStoredBytesCreateOnly(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepRetentionFinal(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepFrozenRefusesNewWork(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepTargetsNeverRemoved(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepSettlementsPermanent(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepRetirementNeedsRelease(b, classify(b, id)))
  ensures (inv(b) ==> canClassify(b, id) ==> stepAccessLogKeepsYear(b, classify(b, id)))
{
  if inv(b) && canClassify(b, id) {
    var after := classify(b, id);
    forall o | o in b.objects
      ensures exists a :: a in after.objects && a.id == o.id && a.declared == o.declared && (o.stored > 0 ==> a.stored == o.stored) && (o.marker ==> a.marker)
    {
      var k :| 0 <= k < |b.objects| && b.objects[k] == o;
      assert after.objects[k] in after.objects;
    }
    forall o | o in b.objects && !o.retention.Kept?
      ensures o in after.objects
    {
      var i :| 0 <= i < |b.objects| && b.objects[i] == o;
      assert !eligible(b, o);
      assert after.objects[i] == o;
    }
  }
}

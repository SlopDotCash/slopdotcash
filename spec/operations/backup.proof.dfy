lemma closeCase_ensures(b: Backup, id: int)
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysBackupPrefix(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysCompleteManifest(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysFailedQueueIsNotComplete(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRestorePrepared(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRestoredExact(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysNeverLivePrefix(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysAdmissionEvidencePermanent(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysDeletionOnlyBacked(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysRetentionNeedsRestoration(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> alwaysOnlyOldEntriesRemoved(closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepReplayKeepsCursor(b, "closeCase", closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepRetentionFinal(b, closeCase(b, id)))
  ensures (inv(b) ==> canCloseCase(b, id) ==> stepAccessLogKeepsYear(b, closeCase(b, id)))
{
  if inv(b) && canCloseCase(b, id) {
    var after := closeCase(b, id);
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
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRestorePrepared(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRestoredExact(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysNeverLivePrefix(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysAdmissionEvidencePermanent(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysDeletionOnlyBacked(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysRetentionNeedsRestoration(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> alwaysOnlyOldEntriesRemoved(retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepReplayKeepsCursor(b, "retain", retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepRetentionFinal(b, retain(b, id)))
  ensures (inv(b) ==> canRetain(b, id) ==> stepAccessLogKeepsYear(b, retain(b, id)))
{
  if inv(b) && canRetain(b, id) {
    var after := retain(b, id);
    forall o | o in b.objects && !o.retention.Kept?
      ensures o in after.objects
    {
      var i :| 0 <= i < |b.objects| && b.objects[i] == o;
      assert !eligible(b, o);
      assert after.objects[i] == o;
    }
  }
}

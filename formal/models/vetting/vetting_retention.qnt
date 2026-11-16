// @source migrations/0066_vetting_case_retention.sql
// @source migrations/0068_vetting_storage_cycles.sql
// @source migrations/0107_vetting_content_addressed_evidence.sql
// @source workers/vetting-backup/core.ts
// @source backend/vetting/evidence.ts
// @source backend/vetting/evidence-retention.ts
// @source backend/vetting/evidence-chunks.ts
// @evidence workers/vetting-backup/qualification-retention.ts
// Historical pre-0119 collector plus the current legacy-hold branch. Three run
// references share a content digest; each selected layout has two part keys.
// Ref1 may declare historical-only key3 while last ref2 declares keys1/2.
// Historical actions allow admitted PUTs after expiry/DELETE/HEAD/receipt.
// They represent verified incoming bytes, not an accepted upload receipt.
// Three selections bound retry/later-cycle work by one cleanup consumer.
// The temporary D1 claim fences new references, not existing R2 writers.
// Shared references receive logical receipts without physical deletion.
// For the last reference, all selected backup parts are checked before DELETE;
// each DELETE, HEAD and final D1 transaction is a separate boundary. A missing
// source+backup part produces retention-missing, not a full deletion receipt.
// Errors retain the claim; committed effects survive lost replies. Eligibility
// is the existing closed/90-day/nonpermanent predicate. Later changes to a
// completed assessment's classification are outside this finite bound.
// Deletion receipts retain historical observations, not current absence.
// Historical keys outside the last layout and post-observation writes remain
// explicit historical diagnostics, outside the current step. Current cleanup
// holds every legacy key; vetting_generation_retirement covers new generations.
// Backup chain validity is supplied by vetting_backup_chain. No checks ran.
module vetting_retention {
  val refs = Set(1, 2, 3)
  val contentKeys = Set(1, 2, 3)
  var s: { present: Set[int], backup: Set[int], verifiedBackup: Set[int],
    closed: Set[int], oldEnough: Set[int], permanent: Set[int],
    references: Set[int], deleted: Set[int], physicalReceipts: Set[int], missingAudits: Set[int],
    layouts: int -> Set[int], pendingUploads: Set[int], admitted: int,
    phase: str, selected: int, selections: int, claim: int, target: Set[int],
    scanIndex: int, backed: Set[int], missing: Set[int], remaining: Set[int],
    deleting: int, observedAbsent: Set[int], safeDeletion: bool, result: str }
  action init = s' = { present: Set(1, 2), backup: Set(), verifiedBackup: Set(),
    closed: Set(), oldEnough: Set(), permanent: Set(), references: Set(1, 2),
    deleted: Set(), physicalReceipts: Set(), missingAudits: Set(),
    layouts: refs.mapBy(_ => Set(1, 2)), pendingUploads: Set(), admitted: 0,
    phase: "idle", selected: 0, selections: 0, claim: 0, target: Set(),
    scanIndex: 0, backed: Set(), missing: Set(), remaining: Set(), deleting: 1,
    observedAbsent: Set(), safeDeletion: true, result: "none" }
  val activeRefs = s.references.exclude(s.deleted)
  val deletionRecorded = s.deleted.size() > 0
  // physicalReceipts labels the final-reference branch of the same source
  // receipt table; shared retirement is deliberately not physical evidence.
  val resurrectionAfterReceipt = s.physicalReceipts.contains(2) and activeRefs.size() == 0
    and s.present.intersect(s.layouts.get(2)).size() > 0
  val unvisitedHistoricalBytes = s.physicalReceipts.contains(2) and activeRefs.size() == 0
    and s.present.contains(3) and not(s.layouts.get(2).contains(3))
  action close(ref: int): bool = all { s.references.contains(ref), s' = s.with("closed", s.closed.union(Set(ref))) }
  action age(ref: int): bool = all { s.closed.contains(ref), s' = s.with("oldEnough", s.oldEnough.union(Set(ref))) }
  action permanentAdmission(ref: int): bool = all { s.phase == "idle", s.selections == 0, s.claim == 0, s.references.contains(ref),
    s' = s.with("permanent", s.permanent.union(Set(ref))) }
  action alternateHistoricalLayout = all { s.phase == "idle", s.selections == 0,
    s' = s.with("layouts", s.layouts.set(1, Set(1, 3))).with("present", s.present.union(Set(3))) }
  action copy = all { s.phase == "idle", s' = s.with("backup", s.present).with("verifiedBackup", Set()) }
  action verifyBackup = all { s.phase == "idle", s' = s.with("verifiedBackup", s.backup) }
  action loseSource(part: int): bool = all { contentKeys.contains(part), s' = s.with("present", s.present.exclude(Set(part))) }
  action loseBackup(part: int): bool = all { contentKeys.contains(part),
    s' = s.with("backup", s.backup.exclude(Set(part))).with("verifiedBackup", s.verifiedBackup.exclude(Set(part))) }
  action corruptBackup(part: int): bool = all { contentKeys.contains(part), s' = s.with("verifiedBackup", s.verifiedBackup.exclude(Set(part))) }
  action addReference(ref: int): bool = all { refs.contains(ref), s.claim == 0, not(s.references.contains(ref)),
    s' = s.with("references", s.references.union(Set(ref))) }
  action startUpload(ref: int, part: int): bool = all { s.references.contains(ref), not(s.oldEnough.contains(ref)),
    s.layouts.get(ref).contains(part), not(s.pendingUploads.contains(part)), s.admitted < 2,
    s' = s.with("pendingUploads", s.pendingUploads.union(Set(part))).with("admitted", s.admitted + 1) }
  action finishUpload(part: int): bool = all { s.pendingUploads.contains(part),
    s' = s.with("pendingUploads", s.pendingUploads.exclude(Set(part))).with("present", s.present.union(Set(part))) }
  action selectReference(ref: int): bool = all { s.phase == "idle", s.selections < 3, activeRefs.contains(ref),
    s.oldEnough.contains(ref), not(s.permanent.contains(ref)), s.claim == 0 or s.claim == ref,
    s' = s.with("phase", "claim").with("selected", ref).with("selections", s.selections + 1)
      .with("target", s.layouts.get(ref)).with("scanIndex", 0).with("backed", Set()).with("missing", Set())
      .with("remaining", Set()).with("observedAbsent", Set()).with("result", "pending") }
  action claimOrShare = all { s.phase == "claim",
    s' = if (activeRefs.exclude(Set(s.selected)).size() > 0) s.with("phase", "shared-commit")
      else s.with("phase", "scan").with("claim", s.selected) }
  action sharedCommit(commits: bool): bool = all { s.phase == "shared-commit",
    s' = if (commits) s.with("deleted", s.deleted.union(Set(s.selected))).with("phase", "reply").with("result", "shared-retired")
      else s.with("phase", "failed").with("result", "database-error") }
  action inspectPart(readable: bool): bool = {
    val part = if (s.scanIndex == 0) 1 else if (s.target.contains(2)) 2 else 3
    val backed = s.backup.contains(part) and s.verifiedBackup.contains(part)
    val missing = not(s.backup.contains(part)) and not(s.present.contains(part))
    val failed = not(readable) or (not(backed) and not(missing))
    val verified = if (backed) s.backed.union(Set(part)) else s.backed
    all { s.phase == "scan", s.scanIndex < 2,
      s' = if (failed) s.with("phase", "failed").with("result", "backup-unavailable")
        else s.with("backed", verified).with("missing", if (missing) s.missing.union(Set(part)) else s.missing)
          .with("scanIndex", s.scanIndex + 1).with("remaining", verified)
          .with("phase", if (s.scanIndex == 1) (if (verified.size() == 0) "commit" else "delete") else "scan") }
  }
  action deletePart(part: int, commits: bool): bool = {
    val nextKey = if (s.remaining.contains(1)) 1 else if (s.remaining.contains(2)) 2 else 3
    all { s.phase == "delete", s.remaining.contains(part), part == nextKey,
      s' = if (commits) s.with("present", s.present.exclude(Set(part))).with("deleting", part).with("phase", "head")
        .with("safeDeletion", s.safeDeletion and s.claim == s.selected and s.backed.contains(part))
        else s.with("phase", "failed").with("result", "delete-error") }
  }
  action loseDeleteReply = all { s.phase == "head", s' = s.with("phase", "failed").with("result", "delete-reply-lost") }
  action observeDelete(readable: bool): bool = all { s.phase == "head",
    s' = if (not(readable) or s.present.contains(s.deleting)) s.with("phase", "failed").with("result", "absence-unconfirmed")
      else s.with("observedAbsent", s.observedAbsent.union(Set(s.deleting))).with("remaining", s.remaining.exclude(Set(s.deleting)))
        .with("phase", if (s.remaining.size() == 1) "commit" else "delete") }
  action commit(commits: bool): bool = all { s.phase == "commit",
    s' = if (not(commits)) s.with("phase", "failed").with("result", "database-error")
      else s.with("deleted", if (s.missing.size() == 0) s.deleted.union(Set(s.selected)) else s.deleted)
        .with("physicalReceipts", if (s.missing.size() == 0) s.physicalReceipts.union(Set(s.selected)) else s.physicalReceipts)
        .with("missingAudits", if (s.missing.size() > 0) s.missingAudits.union(Set(s.selected)) else s.missingAudits)
        .with("claim", 0).with("phase", "reply").with("result", if (s.missing.size() == 0) "deleted" else "retention-missing") }
  action reply = all { s.phase == "reply", s' = s.with("phase", "idle") }
  action loseReply = all { s.phase == "reply", s' = s.with("phase", "failed").with("result", "reply-lost") }
  action retry = all { s.phase == "failed", s' = s.with("phase", "idle") }
  action historicalStep = {
    nondet ref = refs.oneOf()
    nondet part = contentKeys.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { close(ref), age(ref), permanentAdmission(ref), alternateHistoricalLayout, copy, verifyBackup,
      loseSource(part), loseBackup(part), corruptBackup(part), addReference(ref), startUpload(ref, part), finishUpload(part),
      selectReference(ref), claimOrShare, sharedCommit(yes), inspectPart(yes), deletePart(part, yes), loseDeleteReply, observeDelete(yes), commit(yes), reply, loseReply, retry, s' = s }
  }
  action holdLegacy = all { s.phase == "claim", s.claim == 0,
    s' = s.with("phase", "reply").with("result", "retention-held") }
  action step = {
    nondet ref = refs.oneOf()
    nondet part = contentKeys.oneOf()
    any { close(ref), age(ref), permanentAdmission(ref), alternateHistoricalLayout, copy, verifyBackup,
      startUpload(ref, part), finishUpload(part), selectReference(ref), holdLegacy, reply, s' = s }
  }
  val invariant = all { s.safeDeletion, s.deleted.subseteq(s.oldEnough), s.physicalReceipts.subseteq(s.deleted), s.missingAudits.subseteq(s.oldEnough),
    s.verifiedBackup.subseteq(s.backup), s.admitted <= 2, s.selections <= 3,
    s.claim != 0 implies activeRefs.contains(s.claim) and s.oldEnough.contains(s.claim),
    s.result == "deleted" implies s.target.subseteq(s.observedAbsent) }
  action bothExpired = close(1).then(close(2)).then(age(1)).then(age(2))
  action backed = copy.then(verifyBackup)
  action retireFirst = selectReference(1).then(claimOrShare).then(sharedCommit(true)).then(reply)
  action lastReady = selectReference(2).then(claimOrShare).then(inspectPart(true)).then(inspectPart(true))
  action deleteBoth = deletePart(1, true).then(observeDelete(true)).then(deletePart(2, true)).then(observeDelete(true))

  run sharedReferencePreservesObjectTest = init.then(close(1)).then(age(1)).then(backed).then(retireFirst)
    .expect(s.present == Set(1, 2) and activeRefs == Set(2) and s.claim == 0 and invariant)
  run backedUpExpiredReferencesTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady).then(deleteBoth).then(commit(true))
    .expect(s.deleted == Set(1, 2) and s.present.size() == 0 and invariant)
  run admissionEvidencePermanentTest = init.then(permanentAdmission(1)).then(bothExpired).then(backed).then(selectReference(2)).then(claimOrShare).then(sharedCommit(true))
    .expect(s.present == Set(1, 2) and activeRefs == Set(1) and s.claim == 0 and invariant)
  run lateReferencePreventsDeletionTest = init.then(bothExpired).then(backed).then(addReference(3)).then(retireFirst).then(selectReference(2)).then(claimOrShare).then(sharedCommit(true))
    .expect(s.present == Set(1, 2) and activeRefs == Set(3) and invariant)
  run claimBlocksNewReferenceTest = init.then(bothExpired).then(backed).then(retireFirst).then(selectReference(2)).then(claimOrShare).then(addReference(3).fail())
  run missingSourceAndBackupIsNotDeletionReceiptTest = init.then(loseSource(2)).then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deletePart(1, true)).then(observeDelete(true)).then(commit(true))
    .expect(s.missingAudits == Set(2) and s.deleted == Set(1) and s.claim == 0 and invariant)
  run presentSourceWithoutBackupRetainsClaimTest = init.then(bothExpired).then(retireFirst).then(selectReference(2)).then(claimOrShare).then(inspectPart(true))
    .expect(s.phase == "failed" and s.claim == 2 and s.present == Set(1, 2) and invariant)
  run corruptBackupStopsBeforeAnyDeleteTest = init.then(bothExpired).then(backed).then(corruptBackup(2)).then(retireFirst).then(lastReady)
    .expect(s.phase == "failed" and s.present == Set(1, 2) and s.claim == 2)
  run partialDeleteFailureHasNoCompleteReceiptTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deletePart(1, true)).then(observeDelete(true)).then(deletePart(2, false))
    .expect(s.present == Set(2) and s.deleted == Set(1) and s.claim == 2 and invariant)
  run retryRechecksBackupsAndCompletesPartialDeletionTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deletePart(1, true)).then(observeDelete(true)).then(deletePart(2, false)).then(retry).then(lastReady).then(deleteBoth).then(commit(true))
    .expect(s.deleted == Set(1, 2) and s.present.size() == 0 and invariant)
  run deleteReplyCanFailAfterBytesWereRemovedTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deletePart(1, true)).then(loseDeleteReply).expect(not(s.present.contains(1)) and not(s.physicalReceipts.contains(2)) and s.claim == 2)
  run failedHeadReadDoesNotRecordDeletionTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deletePart(1, true)).then(observeDelete(false)).expect(s.claim == 2 and not(s.physicalReceipts.contains(2)))
  run admittedPutAfterDeleteIsSeenByHeadTest = init.then(startUpload(2, 1)).then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deletePart(1, true)).then(finishUpload(1)).then(observeDelete(true))
    .expect(s.phase == "failed" and s.claim == 2 and not(s.deleted.contains(2)))
  run admittedPutAfterHeadCanPrecedeReceiptTest = init.then(startUpload(2, 1)).then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deleteBoth).then(finishUpload(1)).then(commit(true))
    .expect(resurrectionAfterReceipt and s.result == "deleted" and invariant)
  run admittedPutAfterReceiptCanRestoreBytesTest = init.then(startUpload(2, 1)).then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deleteBoth).then(commit(true)).then(finishUpload(1)).expect(resurrectionAfterReceipt and invariant)
  run earlierLayoutKeyIsOutsideLastReferenceDeletionTest = init.then(alternateHistoricalLayout).then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deleteBoth).then(commit(true)).expect(unvisitedHistoricalBytes and invariant)
  run historicalOnlyAdmittedPutCanLandAfterAllReceiptsTest = init.then(alternateHistoricalLayout).then(startUpload(1, 3)).then(loseSource(3))
    .then(bothExpired).then(backed).then(retireFirst).then(lastReady).then(deleteBoth).then(commit(true)).then(finishUpload(3))
    .expect(unvisitedHistoricalBytes and invariant)
  run committedReceiptSurvivesLostReplyTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady).then(deleteBoth).then(commit(true)).then(loseReply).then(retry)
    .expect(s.deleted == Set(1, 2) and s.claim == 0 and invariant)
  run newSnapshotCannotInheritPriorByteVerificationTest = init.then(bothExpired).then(backed).then(retireFirst).then(lastReady)
    .then(deleteBoth).then(commit(true)).then(reply).then(copy)
    .expect(s.backup.size() == 0 and s.verifiedBackup.size() == 0 and invariant)
  run currentLegacyCleanupHoldsBytesTest = init.then(bothExpired).then(backed).then(selectReference(1)).then(holdLegacy).then(reply)
    .expect(s.present == Set(1, 2) and s.deleted.size() == 0 and s.result == "retention-held" and invariant)
  run currentLegacyHoldDoesNotPretendToFenceOldWriterTest = init.then(startUpload(1, 1)).then(bothExpired)
    .then(selectReference(1)).then(holdLegacy).then(reply).then(finishUpload(1))
    .expect(s.present == Set(1, 2) and s.physicalReceipts.size() == 0 and invariant)
}

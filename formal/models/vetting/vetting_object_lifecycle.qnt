// @source backend/vetting/evidence.ts
// @source backend/vetting/evidence-retention.ts
// @source workers/vetting-backup/core.ts
// @source migrations/0034_vetting_private_evidence.sql
// @source migrations/0036_vetting_evidence_assembly.sql
// @source migrations/0066_vetting_case_retention.sql
// @source migrations/0107_vetting_content_addressed_evidence.sql
// Historical pre-0119 cleanup counterexample. These transitions describe the
// replaced collector, not the current generation protocol. Current legacy
// storage is held; new generations have separate reservation/retirement models.
// One shared content digest, three run references, two competing registration
// payloads, all non-permanent. Crypto/whole-byte equality are abstracted. Cleanup first
// fences new references, while expired shared references are retired logically.
// Upload admission and R2 completion are separate. An admitted request can
// finish after expiry, physical deletion and its receipt; the current claim
// fences registration, not an already submitted write. lateResurrection is a
// historical diagnostic, not an invariant. The primary step excludes this
// retired DELETE protocol; current legacy cleanup holds its bytes instead.
module vetting_object_lifecycle {
  var s: { manifest: int, aRead: bool, bRead: bool, aResult: str, bResult: str,
    refs: Set[int], expired: Set[int], completed: Set[int], deleted: Set[int],
    present: bool, valid: bool, backup: bool, claim: int, safeDeletion: bool,
    pendingUploads: Set[int], lateResurrection: bool }
  action init = s' = {manifest: 0, aRead: false, bRead: false, aResult: "pending", bResult: "pending",
    refs: Set(), expired: Set(), completed: Set(), deleted: Set(),
    present: false, valid: false, backup: false, claim: 0, safeDeletion: true,
    pendingUploads: Set(), lateResurrection: false}
  action readA = all { s.aResult == "pending", s' = s.with("aRead", true) }
  action readB = all { s.bResult == "pending", s' = s.with("bRead", true) }
  action commitA = all { s.aRead, s.aResult == "pending", s.claim == 0,
    s' = if (s.manifest == 0) s.with("manifest", 1).with("refs", s.refs.union(Set(1))).with("aResult", "created")
      else s.with("aResult", if (s.manifest == 1) "replayed" else "conflict") }
  action commitB(payload: int): bool = all { s.bRead, s.bResult == "pending", s.claim == 0,
    s' = if (s.manifest == 0) s.with("manifest", payload).with("refs", s.refs.union(Set(1))).with("bResult", "created")
      else s.with("bResult", if (s.manifest == payload) "replayed" else "conflict") }
  action registerShared(ref: int): bool = all { s.claim == 0, not(s.refs.contains(ref)),
    s' = s.with("refs", s.refs.union(Set(ref))) }
  action startUpload(ref: int): bool = all { s.refs.contains(ref), not(s.expired.contains(ref)),
    not(s.pendingUploads.contains(ref)), s' = s.with("pendingUploads", s.pendingUploads.union(Set(ref))) }
  action finishUpload(ref: int): bool = all { s.pendingUploads.contains(ref),
    s' = s.with("present", true).with("valid", true)
      .with("pendingUploads", s.pendingUploads.exclude(Set(ref)))
      .with("lateResurrection", s.lateResurrection or s.deleted.contains(ref)) }
  action upload(ref: int): bool = startUpload(ref).then(finishUpload(ref))
  action corrupt = all { s.present, s' = s.with("valid", false) }
  action finalize(ref: int): bool = all { s.refs.contains(ref), not(s.expired.contains(ref)),
    s.present, s.valid, s' = s.with("completed", s.completed.union(Set(ref))) }
  action expire(ref: int): bool = all { s.refs.contains(ref), s' = s.with("expired", s.expired.union(Set(ref))) }
  action verifiedBackup = all { s.present, s.valid, s' = s.with("backup", true) }
  val activeRefs = s.refs.exclude(s.deleted)
  action retireShared(ref: int): bool = all { activeRefs.contains(ref), s.expired.contains(ref),
    activeRefs.exclude(Set(ref)).size() > 0, s.claim == 0,
    s' = s.with("deleted", s.deleted.union(Set(ref))) }
  action claimDelete(ref: int): bool = all { activeRefs == Set(ref), s.expired.contains(ref),
    s.claim == 0, s' = s.with("claim", ref) }
  action deleteBytes = all { s.claim != 0, s.backup,
    s' = s.with("present", false).with("valid", false)
      .with("safeDeletion", s.safeDeletion and activeRefs == Set(s.claim) and s.expired.contains(s.claim)) }
  action recordDelete = all { s.claim != 0, not(s.present), s.backup,
    s' = s.with("deleted", s.deleted.union(Set(s.claim))).with("claim", 0) }
  action historicalStep = { nondet ref = Set(1, 2, 3).oneOf(); nondet payload = Set(1, 2).oneOf()
    any { readA, readB, commitA, commitB(payload), registerShared(ref), startUpload(ref), finishUpload(ref), corrupt,
      finalize(ref), expire(ref), verifiedBackup, retireShared(ref), claimDelete(ref), deleteBytes, recordDelete, s' = s } }
  action step = { nondet ref = Set(1, 2, 3).oneOf(); nondet payload = Set(1, 2).oneOf()
    any { readA, readB, commitA, commitB(payload), registerShared(ref), startUpload(ref), finishUpload(ref), corrupt,
      finalize(ref), expire(ref), verifiedBackup, s' = s } }
  val invariant = all { s.safeDeletion, s.completed.subseteq(s.refs), s.deleted.subseteq(s.expired),
    s.claim != 0 implies s.refs.contains(s.claim) and s.expired.contains(s.claim),
    s.aResult == "created" implies s.manifest == 1,
    s.aResult == "replayed" implies s.manifest == 1 }
  run concurrentIdenticalRegistrationReplaysTest = init.then(readA).then(readB).then(commitB(1)).then(commitA)
    .expect(s.aResult == "replayed" and s.bResult == "created" and s.refs == Set(1))
  run concurrentChangedRegistrationConflictsTest = init.then(readA).then(readB).then(commitB(2)).then(commitA)
    .expect(s.aResult == "conflict" and s.bResult == "created" and s.manifest == 2)
  run sharedBytesNeedOwnCompletionTest = init.then(readA).then(commitA).then(upload(1)).then(finalize(1))
    .then(registerShared(2)).expect(s.completed == Set(1) and s.refs == Set(1, 2))
  run liveSiblingSurvivesCleanupTest = init.then(readA).then(commitA).then(registerShared(2)).then(upload(1))
    .then(finalize(1)).then(expire(1)).then(verifiedBackup).then(retireShared(1))
    .expect(s.present and activeRefs == Set(2)).then(claimDelete(2).fail())
  run cleanupFenceBlocksNewReferenceTest = init.then(readA).then(commitA).then(upload(1)).then(finalize(1))
    .then(expire(1)).then(verifiedBackup).then(claimDelete(1)).then(registerShared(2).fail())
  run missingBackupKeepsCleanupFenceTest = init.then(readA).then(commitA).then(expire(1)).then(claimDelete(1))
    .expect(not(s.backup) and s.claim == 1).then(deleteBytes.fail())
  run laterReferenceRequiresRepairTest = init.then(readA).then(commitA).then(upload(1)).then(finalize(1))
    .then(expire(1)).then(verifiedBackup).then(claimDelete(1)).then(deleteBytes).then(recordDelete)
    .then(registerShared(2)).expect(not(s.present)).then(upload(2)).then(finalize(2)).expect(s.present and s.completed == Set(1, 2))
  run admittedUploadCanFinishAfterRetirementTest = init.then(readA).then(commitA).then(upload(1))
    .then(verifiedBackup).then(startUpload(1)).then(expire(1)).then(claimDelete(1))
    .then(deleteBytes).then(recordDelete).then(finishUpload(1))
    .expect(s.present and s.deleted == Set(1) and s.lateResurrection and invariant)
}

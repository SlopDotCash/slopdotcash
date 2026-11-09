// @source workers/vetting-backup/core.ts
// @source backend/vetting/evidence-storage.ts
// @source backend/vetting/evidence-chunks.ts
// @source migrations/0119_vetting_storage_generations.sql
// @evidence workers/vetting-backup/generation-retirement.workflow.mjs
// Current forward protocol: one retiring generation, two references/declared
// slots, three reserved physical targets (including an orphan/old head), and
// one fresh successor-generation target. Two retries bound one queue consumer;
// the source's LIMIT16 target batches are abstracted by one selected target.
// Raw backups preserve observed bytes even when the evidence tuple disagrees:
// changed is distinct from backed and never qualifies a declared slot. An
// unbound orphan backup cannot authorize replacement; the source is reread.
// Byte/digest/size equality and full slot tuples are exact predicates: slot2
// differs from slot1, while target3 is a replacement for slot1. Valid bytes
// include zero-length evidence; a nonempty canonical marker is never evidence.
// A completed primary snapshot admits cleanup. Its page-chain proof is supplied
// by vetting_backup_chain. Supplemental receipts bind the same snapshot digest.
// Copy, verification, immutable receipt, marker, D1 commit, exact readback and
// queue reply are separate. Committed effects survive a failed/lost reply.
// No fairness, eventual retry, backup lifecycle retention or clock progress is
// assumed. Eligibility collapses the exact closed/90-day/nonpermanent predicate;
// it does not infer a completed classification from an incomplete assessment.
// Atomic D1 triggers prevent target/head/reference publication after freeze.
// R2 create-only is assumed atomic at commit; every forward writer uses it and
// never reuses a physical key. No external writer, marker removal or corruption
// after freeze is included. These are deployment/storage assumptions,
// not proven provider facts. Legacy null-generation keys are held, not deleted.
// The old absence-then-unconditional-marker counterexample is outside step.
// Restore success below is the supplemental path; primary-only restores and
// arbitrary malformed JSON are covered by runtime validation, not enumerated.
// No model, workflow, parser or runtime check was executed for this change.
module vetting_generation_retirement {
  val targets = Set(1, 2, 3)
  val refs = Set(1, 2)
  val slots = Set(1, 2)
  def tuple(target: int): int = if (target == 2) 2 else 1
  var s: {
    generation: str, references: Set[int], eligible: Set[int], permanent: Set[int],
    reserved: Set[int], heads: int -> int, disk: int -> str, pending: Set[int],
    markers: Set[int], backups: Set[int], validBackups: Set[int], verified: Set[int],
    changedBackups: Set[int], conflictingOrphans: Set[int],
    primary: Set[int], snapshot: bool, receipts: int -> str, recorded: Set[int],
    phase: str, selected: int, outcome: str, retries: int, result: str,
    deleted: Set[int], missingAudits: Set[int], held: bool, restore: str,
    successor: bool, successorBody: bool, lost: bool
  }
  action init = s' = {
    generation: "active", references: Set(1), eligible: Set(), permanent: Set(),
    reserved: Set(1, 2), heads: slots.mapBy(slot => if (slot == 1) 1 else 0),
    disk: targets.mapBy(target => if (target == 1) "body" else "absent"),
    pending: Set(), markers: Set(), backups: Set(), validBackups: Set(),
    verified: Set(), changedBackups: Set(), conflictingOrphans: Set(), primary: Set(), snapshot: false,
    receipts: targets.mapBy(_ => "none"), recorded: Set(), phase: "idle",
    selected: 1, outcome: "none", retries: 0, result: "none",
    deleted: Set(), missingAudits: Set(), held: false, restore: "none",
    successor: false, successorBody: false, lost: false
  }
  action addReference = all { s.generation == "active", not(s.references.contains(2)),
    s' = s.with("references", s.references.union(Set(2))) }
  action expire(ref: int): bool = all { s.references.contains(ref),
    s' = s.with("eligible", s.eligible.union(Set(ref))) }
  action preserve(ref: int): bool = all { s.generation == "active", s.references.contains(ref),
    s' = s.with("permanent", s.permanent.union(Set(ref))) }
  action reserveOldHead = all { s.generation == "active", not(s.reserved.contains(3)),
    s' = s.with("reserved", s.reserved.union(Set(3))) }
  action admit(target: int): bool = all { s.generation == "active", s.reserved.contains(target),
    not(s.pending.contains(target)), s' = s.with("pending", s.pending.union(Set(target))) }
  action finishPut(target: int): bool = all { s.pending.contains(target),
    s' = s.with("pending", s.pending.exclude(Set(target)))
      .with("disk", if (s.disk.get(target) == "absent") s.disk.set(target, "body") else s.disk) }
  action publishHead(slot: int, target: int): bool = all {
    s.generation == "active", s.reserved.contains(target), slots.contains(slot),
    tuple(target) == slot, s.disk.get(target) == "body",
    s' = s.with("heads", s.heads.set(slot, target)) }
  action corruptBeforeFreeze(target: int): bool = all { s.generation == "active",
    s.disk.get(target) == "body", s' = s.with("disk", s.disk.set(target, "corrupt")) }
  action primaryCopy(target: int): bool = all { not(s.snapshot), Set("body", "corrupt").contains(s.disk.get(target)),
    s' = s.with("backups", s.backups.union(Set(target)))
      .with("validBackups", s.validBackups.union(Set(target)))
      .with("changedBackups", if (s.disk.get(target) == "corrupt") s.changedBackups.union(Set(target)) else s.changedBackups)
      .with("primary", s.primary.union(Set(target))) }
  action seedConflictingOrphan(target: int): bool = all { not(s.snapshot),
    s' = s.with("backups", s.backups.union(Set(target)))
      .with("conflictingOrphans", s.conflictingOrphans.union(Set(target))) }
  action completeSnapshot = all { not(s.snapshot), s' = s.with("snapshot", true) }
  action freeze = all { s.phase == "idle", s.snapshot, s.generation == "active",
    s.references.subseteq(s.eligible), s.references.intersect(s.permanent).size() == 0,
    s' = s.with("generation", "retiring").with("phase", "choose") }
  action holdShared = all { s.snapshot, s.generation == "active",
    not(s.references.subseteq(s.eligible)) or s.references.intersect(s.permanent).size() > 0,
    s' = s.with("held", true).with("result", "retention-held") }
  action holdLegacy = all { s.phase == "idle", s' = s.with("held", true).with("result", "legacy-held") }
  action choose(target: int): bool = all { s.phase == "choose", s.generation == "retiring",
    s.reserved.contains(target), not(s.recorded.contains(target)),
    s' = s.with("selected", target).with("phase", "inspect").with("outcome", "none") }
  action inspect = {
    val target = s.selected
    val recorded = s.receipts.get(target)
    val phase = if (recorded == "missing") "verify-recorded-missing"
      else if (s.backups.contains(target) and (s.primary.contains(target) or recorded != "none")) "verify-backup"
      else if (recorded == "backed") "failed"
      else if (Set("body", "corrupt").contains(s.disk.get(target))) "copy"
      else if (s.disk.get(target) == "absent") "create-missing"
      else if (s.disk.get(target) == "marker-missing") "verify-new-missing"
      else "failed"
    all { s.phase == "inspect",
      s' = s.with("phase", phase).with("outcome", if (recorded == "missing" or
        Set("create-missing", "verify-new-missing").contains(phase)) "missing" else "backed") }
  }
  action copyBody(commits: bool): bool = all { s.phase == "copy", Set("body", "corrupt").contains(s.disk.get(s.selected)),
    s' = if (commits and not(s.conflictingOrphans.contains(s.selected))) s.with("backups", s.backups.union(Set(s.selected)))
      .with("validBackups", s.validBackups.union(Set(s.selected)))
      .with("changedBackups", if (s.disk.get(s.selected) == "corrupt") s.changedBackups.union(Set(s.selected)) else s.changedBackups)
      .with("phase", "verify-backup")
      else s.with("phase", "failed").with("result", "copy-error") }
  action verifyBackup(readable: bool): bool = all { s.phase == "verify-backup",
    s' = if (readable and s.validBackups.contains(s.selected))
      s.with("verified", s.verified.union(Set(s.selected)))
        .with("outcome", if (s.changedBackups.contains(s.selected)) "changed" else "backed")
        .with("phase", if (s.receipts.get(s.selected) != "none") "write-backed" else "receipt")
      else s.with("phase", "failed").with("result", "backup-unavailable") }
  action createMissingMarker(commits: bool): bool = all { s.phase == "create-missing",
    s' = if (not(commits)) s.with("phase", "failed").with("result", "marker-error")
      else if (s.disk.get(s.selected) == "absent")
        s.with("disk", s.disk.set(s.selected, "marker-missing"))
          .with("markers", s.markers.union(Set(s.selected))).with("phase", "verify-new-missing")
      else s.with("phase", "inspect").with("outcome", "none") }
  action writeBackedMarker(commits: bool): bool = all { s.phase == "write-backed",
    Set("backed", "changed").contains(s.receipts.get(s.selected)), s.verified.contains(s.selected),
    s' = if (commits) s.with("disk", s.disk.set(s.selected, if (s.outcome == "changed") "marker-changed" else "marker-backed"))
      .with("markers", s.markers.union(Set(s.selected))).with("phase", "verify-backed")
      else s.with("phase", "failed").with("result", "marker-error") }
  action verifyMarker(readable: bool): bool = {
    val missing = s.phase != "verify-backed"
    val matches = s.disk.get(s.selected) == (if (missing) "marker-missing"
      else if (s.outcome == "changed") "marker-changed" else "marker-backed")
    all { Set("verify-new-missing", "verify-recorded-missing", "verify-backed").contains(s.phase),
      s' = if (readable and matches) s.with("phase", if (s.phase == "verify-new-missing") "receipt" else "database")
        else s.with("phase", "failed").with("result", "marker-unconfirmed") }
  }
  action publishReceipt(commits: bool): bool = all { s.phase == "receipt",
    s.receipts.get(s.selected) == "none",
    (Set("backed", "changed").contains(s.outcome) and s.verified.contains(s.selected)) or
      (s.outcome == "missing" and s.disk.get(s.selected) == "marker-missing"),
    s' = if (commits) s.with("receipts", s.receipts.set(s.selected, s.outcome))
      .with("phase", if (s.outcome != "missing") "write-backed" else "database")
      else s.with("phase", "failed").with("result", "receipt-error") }
  action recordRetirement(commits: bool): bool = all { s.phase == "database",
    s.disk.get(s.selected) == (if (s.receipts.get(s.selected) == "backed") "marker-backed"
      else if (s.receipts.get(s.selected) == "changed") "marker-changed" else "marker-missing"),
    s' = if (commits) s.with("recorded", s.recorded.union(Set(s.selected))).with("phase", "readback")
      else s.with("phase", "failed").with("result", "database-error") }
  action readback(visible: bool): bool = all { s.phase == "readback",
    s' = if (visible and s.recorded.contains(s.selected)) s.with("phase", "choose")
      else s.with("phase", "failed").with("result", "readback-error") }
  action failedState = all { not(Set("idle", "choose", "done", "failed").contains(s.phase)),
    s' = s.with("phase", "failed").with("result", "reply-lost").with("lost", true) }
  action retry = all { s.phase == "failed", s.retries < 2,
    s' = s.with("phase", "choose").with("retries", s.retries + 1) }
  action finishGeneration = all { s.phase == "choose", s.reserved.subseteq(s.recorded),
    s' = s.with("generation", "retired").with("phase", "done").with("result", "retired") }
  def required(ref: int): Set[int] = if (ref == 1) Set(1) else Set(1, 2)
  def backedSlot(slot: int): bool = {
    val target = s.heads.get(slot)
    target != 0 and s.recorded.contains(target) and s.receipts.get(if (target == 0) 1 else target) == "backed"
  }
  action referenceReceipt(ref: int): bool = all { s.generation == "retired", s.references.contains(ref),
    s' = if (required(ref).forall(slot => backedSlot(slot))) s.with("deleted", s.deleted.union(Set(ref)))
      else s.with("missingAudits", s.missingAudits.union(Set(ref))) }
  action restoreSupplement(target: int, chainMatches: bool, bytesMatch: bool): bool = all {
    s.snapshot, s.receipts.get(target) != "none",
    s' = s.with("restore", if (chainMatches and bytesMatch and
      Set("backed", "changed").contains(s.receipts.get(target)) and s.validBackups.contains(target))
        (if (s.receipts.get(target) == "changed") "changed-restored" else "restored") else "refused") }
  action allocateSuccessor = all { s.generation != "active", not(s.successor),
    s' = s.with("successor", true) }
  action writeSuccessor = all { s.successor, s' = s.with("successorBody", true) }
  // Old HEAD(absent)->unconditional marker could discard an admitted body.
  // The fixed step never contains this action.
  action historicalOverwriteMissing = all { s.phase == "create-missing", s.disk.get(s.selected) == "body",
    s' = s.with("disk", s.disk.set(s.selected, "marker-missing"))
      .with("markers", s.markers.union(Set(s.selected))).with("lost", true) }
  action step = {
    nondet target = targets.oneOf()
    nondet ref = refs.oneOf()
    nondet slot = slots.oneOf()
    nondet yes = Set(false, true).oneOf()
    nondet intact = Set(false, true).oneOf()
    any { addReference, expire(ref), preserve(ref), reserveOldHead, admit(target), finishPut(target),
      publishHead(slot, target), corruptBeforeFreeze(target), primaryCopy(target), seedConflictingOrphan(target), completeSnapshot,
      freeze, holdShared, holdLegacy, choose(target), inspect, copyBody(yes), verifyBackup(yes),
      createMissingMarker(yes), writeBackedMarker(yes), verifyMarker(yes), publishReceipt(yes),
      recordRetirement(yes), readback(yes), failedState, retry, finishGeneration, referenceReceipt(ref),
      restoreSupplement(target, yes, intact), allocateSuccessor, writeSuccessor, s' = s }
  }
  val invariant = all {
    s.recorded.subseteq(s.markers), s.markers.forall(target =>
      Set("marker-backed", "marker-changed", "marker-missing").contains(s.disk.get(target))),
    targets.forall(target => s.disk.get(target) == "marker-backed" implies
      s.receipts.get(target) == "backed" and s.validBackups.contains(target)),
    targets.forall(target => s.disk.get(target) == "marker-changed" implies
      s.receipts.get(target) == "changed" and s.changedBackups.contains(target) and s.validBackups.contains(target)),
    targets.forall(target => s.receipts.get(target) == "missing" implies
      s.disk.get(target) == "marker-missing"),
    s.generation == "retired" implies s.reserved.subseteq(s.recorded),
    s.deleted.forall(ref => required(ref).forall(slot => backedSlot(slot))),
    s.deleted.subseteq(s.eligible), s.retries <= 2
  }
  action ready = expire(1).then(primaryCopy(1)).then(completeSnapshot).then(freeze)
  action finishRecorded = recordRetirement(true).then(readback(true))
  action retirePrimary = choose(1).then(inspect).then(verifyBackup(true)).then(publishReceipt(true))
    .then(writeBackedMarker(true)).then(verifyMarker(true)).then(finishRecorded)
  action retireMissing(target: int): bool = choose(target).then(inspect).then(createMissingMarker(true))
    .then(verifyMarker(true)).then(publishReceipt(true)).then(finishRecorded)
  action retireSupplement(target: int): bool = choose(target).then(inspect).then(copyBody(true))
    .then(verifyBackup(true)).then(publishReceipt(true)).then(writeBackedMarker(true))
    .then(verifyMarker(true)).then(finishRecorded)

  run currentReferenceHoldsGenerationTest = init.then(completeSnapshot).then(holdShared)
    .expect(s.generation == "active" and s.held and s.markers.size() == 0 and invariant)
  run permanentReferenceHoldsGenerationTest = init.then(expire(1)).then(preserve(1)).then(completeSnapshot).then(holdShared)
    .expect(s.generation == "active" and invariant)
  run freezeRejectsNewReferenceTest = init.then(ready).then(addReference.fail())
  run freezeRejectsNewPhysicalReservationTest = init.then(ready).then(reserveOldHead.fail())
  run freezeRejectsHeadPublicationTest = init.then(ready).then(publishHead(1, 1).fail())
  run backedHeadAndMissingOrphanRetireTest = init.then(ready).then(retirePrimary).then(retireMissing(2))
    .then(finishGeneration).then(referenceReceipt(1)).expect(s.deleted == Set(1) and invariant)
  run allReservedTargetsIncludeUnpublishedOldHeadTest = init.then(reserveOldHead).then(ready)
    .then(retirePrimary).then(retireMissing(2)).then(finishGeneration.fail())
  run oldHeadIsFencedBeforeGenerationRetiresTest = init.then(reserveOldHead).then(ready)
    .then(retirePrimary).then(retireMissing(2)).then(retireMissing(3)).then(finishGeneration)
    .expect(s.recorded == targets and invariant)
  run markerWinsBeforeAdmittedBodyTest = init.then(admit(2)).then(ready).then(retireMissing(2)).then(finishPut(2))
    .expect(s.disk.get(2) == "marker-missing" and s.receipts.get(2) == "missing" and invariant)
  run admittedBodyWinsAbsentObservationTest = init.then(admit(2)).then(ready).then(choose(2)).then(inspect)
    .then(finishPut(2)).then(createMissingMarker(true)).then(inspect).then(copyBody(true)).then(verifyBackup(true))
    .then(publishReceipt(true)).then(writeBackedMarker(true)).then(verifyMarker(true)).then(finishRecorded)
    .expect(s.receipts.get(2) == "backed" and s.disk.get(2) == "marker-backed" and invariant)
  run oldUnconditionalMissingMarkerLosesBodyNegativeControlTest = init.then(admit(2)).then(ready)
    .then(choose(2)).then(inspect).then(finishPut(2)).then(historicalOverwriteMissing)
    .expect(s.disk.get(2) == "marker-missing" and not(s.backups.contains(2)) and s.lost)
  run missingMarkerCommitSurvivesLostReplyTest = init.then(ready).then(choose(2)).then(inspect)
    .then(createMissingMarker(true)).then(failedState).then(retry).then(choose(2)).then(inspect)
    .then(verifyMarker(true)).then(publishReceipt(true)).then(finishRecorded)
    .expect(s.recorded.contains(2) and s.receipts.get(2) == "missing" and invariant)
  run backedReceiptBeforeMarkerSurvivesFailureTest = init.then(ready).then(choose(1)).then(inspect)
    .then(verifyBackup(true)).then(publishReceipt(true)).then(writeBackedMarker(false)).then(retry)
    .then(choose(1)).then(inspect).then(verifyBackup(true)).then(writeBackedMarker(true))
    .then(verifyMarker(true)).then(finishRecorded).expect(s.recorded.contains(1) and invariant)
  run markerCommitCanPrecedeFailedReadbackTest = init.then(ready).then(choose(1)).then(inspect)
    .then(verifyBackup(true)).then(publishReceipt(true)).then(writeBackedMarker(true)).then(verifyMarker(false))
    .expect(s.disk.get(1) == "marker-backed" and not(s.recorded.contains(1)) and invariant)
  run databaseCommitSurvivesLostReplyTest = init.then(ready).then(choose(1)).then(inspect)
    .then(verifyBackup(true)).then(publishReceipt(true)).then(writeBackedMarker(true)).then(verifyMarker(true))
    .then(recordRetirement(true)).then(failedState).then(retry)
    .expect(s.recorded.contains(1) and s.phase == "choose" and invariant)
  run missingReadbackCannotInventDatabaseReceiptTest = init.then(ready).then(choose(2)).then(inspect)
    .then(createMissingMarker(true)).then(verifyMarker(true)).then(publishReceipt(true))
    .then(recordRetirement(true)).then(readback(false)).expect(s.phase == "failed" and s.recorded.contains(2) and invariant)
  run changedSourceIsPreservedWithoutBackingExpectedSlotTest = init.then(corruptBeforeFreeze(1))
    .then(expire(1)).then(completeSnapshot).then(freeze).then(retireSupplement(1)).then(retireMissing(2))
    .then(finishGeneration).then(referenceReceipt(1)).then(restoreSupplement(1, true, true))
    .expect(s.missingAudits == Set(1) and s.restore == "changed-restored" and invariant)
  run copyCommitSurvivesLostVerificationReplyTest = init.then(admit(2)).then(finishPut(2)).then(ready)
    .then(choose(2)).then(inspect).then(copyBody(true)).then(failedState).then(retry).then(choose(2))
    .then(inspect).then(copyBody(true)).then(verifyBackup(true)).then(publishReceipt(true)).then(writeBackedMarker(true))
    .then(verifyMarker(true)).then(finishRecorded).expect(s.recorded.contains(2) and invariant)
  run supplementalBackupRestoresOnlyWithMatchingChainTest = init.then(admit(2)).then(finishPut(2))
    .then(ready).then(retireSupplement(2)).then(restoreSupplement(2, true, true))
    .expect(s.restore == "restored" and not(s.primary.contains(2)) and invariant)
  run wrongSnapshotAnchorRefusesRestoreTest = init.then(admit(2)).then(finishPut(2)).then(ready)
    .then(retireSupplement(2)).then(restoreSupplement(2, false, true)).expect(s.restore == "refused" and invariant)
  run wrongCopiedBytesRefuseRestoreTest = init.then(admit(2)).then(finishPut(2)).then(ready)
    .then(retireSupplement(2)).then(restoreSupplement(2, true, false)).expect(s.restore == "refused" and invariant)
  run missingOutcomeIsNotBackupEvidenceTest = init.then(ready).then(retireMissing(2))
    .then(restoreSupplement(2, true, true)).expect(s.restore == "refused" and invariant)
  run missingDeclaredHeadDoesNotEarnDeletionReceiptTest = init.then(addReference).then(expire(2))
    .then(ready).then(retirePrimary).then(retireMissing(2)).then(finishGeneration).then(referenceReceipt(2))
    .expect(s.missingAudits == Set(2) and s.deleted.size() == 0 and invariant)
  run distinctSlotRequiresExactBackedHeadTest = init.then(addReference).then(admit(2)).then(finishPut(2))
    .then(publishHead(2, 2)).then(expire(2)).then(ready).then(retirePrimary).then(retireSupplement(2))
    .then(finishGeneration).then(referenceReceipt(2)).expect(s.deleted == Set(2) and invariant)
  run freshGenerationDoesNotReuseRetiredKeysTest = init.then(ready).then(retirePrimary).then(retireMissing(2))
    .then(finishGeneration).then(allocateSuccessor).then(writeSuccessor)
    .expect(s.successorBody and s.disk.get(1) == "marker-backed" and invariant)
  run legacyHoldNeverFabricatesDeletionTest = init.then(holdLegacy)
    .expect(s.result == "legacy-held" and s.deleted.size() == 0 and s.markers.size() == 0 and invariant)
  run conflictingOrphanBackupCannotAuthorizeMarkerTest = init.then(seedConflictingOrphan(1))
    .then(expire(1)).then(completeSnapshot).then(freeze).then(choose(1)).then(inspect).then(copyBody(true))
    .expect(s.phase == "failed" and s.markers.size() == 0 and s.receipts.get(1) == "none" and invariant)
  run primaryChangedBytesDoNotBlockSnapshotAndRetirementTest = init.then(corruptBeforeFreeze(1)).then(ready)
    .then(retirePrimary).then(restoreSupplement(1, true, true))
    .expect(s.receipts.get(1) == "changed" and s.restore == "changed-restored" and invariant)
}

// @source workers/vetting-backup/core.ts
// @source backend/vetting/evidence-chunks.ts
// @source workers/vetting-backup/qualification.ts
// @source workers/vetting-backup/qualification-entry.ts
// @source workers/vetting-backup/qualification-retention.ts
// @source workers/vetting-backup/workflow.mjs
// @source workers/vetting-backup/qualification-workflow.mjs
// @source migrations/0068_vetting_storage_cycles.sql
// One day, two pages with one object each, six queue deliveries, two duplicate
// deliveries and three restore attempts. Presence, verified bytes, publication,
// continuation, D1 phase and caller success are separate. Queue multiplicity is
// abstracted by pending membership plus explicit replay; retention is separate.
module vetting_backup_chain {
  val objects = Set(0, 1)
  val jobs = Set(0, 1, 2) // 2 is cleanup, not another backup page.
  var s: { phase: str, day: int, stage: str, job: int,
    startPresent: bool, startValid: bool, present: Set[int], exact: Set[int],
    copied: Set[int], pages: Set[int], validPages: Set[int], pageHistory: Set[int],
    completePresent: bool, completeReceipt: bool, completeWitness: bool, completionObserved: bool,
    pending: Set[int], seen: Set[int], deliveries: int, replays: int,
    acknowledgments: int, outcome: str, restoreStage: str, selected: int,
    restoreAttempts: int, destinations: Set[int], exactDestinations: Set[int],
    restored: Set[int], restoreOutcome: str }
  action init = s' = { phase: "idle", day: 0, stage: "none", job: -1,
    startPresent: false, startValid: false, present: Set(), exact: Set(),
    copied: Set(), pages: Set(), validPages: Set(), pageHistory: Set(), completePresent: false,
    completeReceipt: false, completeWitness: false, completionObserved: false, pending: Set(), seen: Set(),
    deliveries: 0, replays: 0, acknowledgments: 0, outcome: "none",
    restoreStage: "none", selected: 0, restoreAttempts: 0,
    destinations: Set(), exactDestinations: Set(), restored: Set(), restoreOutcome: "none" }
  val cursor = s.pages.size()
  // D1's unique active-cycle constraint precedes any R2 publication.
  action start = all { s.phase == "idle",
    s' = s.with("phase", "backup").with("day", 1).with("stage", "start-put") }
  action putStart(creates: bool): bool = all { s.stage == "start-put",
    s' = s.with("stage", "start-read").with("startPresent", s.startPresent or creates)
      .with("startValid", s.startValid or (creates and not(s.startPresent))) }
  action readStart = all { s.stage == "start-read",
    s' = if (s.startPresent and s.startValid)
        s.with("pending", s.pending.union(Set(0))).with("stage", "none").with("outcome", "scheduled")
      else s.with("stage", "failed") }
  // A later cron resumes the active day. Exact date selection is outside this model.
  action resume = all { s.stage == "none", s.phase != "idle", s.phase != "complete",
    s' = s.with("job", -1).with("completionObserved", false).with("stage", if (s.phase == "cleanup") "cleanup-send"
      else if (s.completePresent) "complete-read"
      else if (s.startPresent) "start-read" else "start-put") }
  action deliver(page: int): bool = all {
    s.stage == "none", jobs.contains(page), s.pending.contains(page), s.deliveries < 6,
    s' = s.with("pending", s.pending.exclude(Set(page))).with("job", page)
      .with("seen", s.seen.union(Set(page))).with("deliveries", s.deliveries + 1)
      .with("completionObserved", false)
      .with("stage", if (s.phase == "complete") "ack"
        else if (page == 2) (if (s.phase == "cleanup") "cleanup-work" else "failed")
        else if (s.phase == "cleanup") "cleanup-send" else "load-start") }
  action loadStart = all { s.stage == "load-start",
    s' = s.with("stage", if (s.startPresent and s.startValid) "load-page" else "failed") }
  action loadPage = all { s.stage == "load-page", objects.contains(s.job),
    s' = s.with("stage", if (s.pages.contains(s.job))
      (if (s.validPages.contains(s.job)) (if (s.job == 0) "next-send" else "complete-put") else "failed")
      else "copy-put") }
  // Create-only put may commit before its response or readback fails.
  action copy(creates: bool): bool = all { s.stage == "copy-put",
    s' = s.with("stage", "copy-read")
      .with("present", if (creates) s.present.union(Set(s.job)) else s.present)
      .with("exact", if (creates and not(s.present.contains(s.job))) s.exact.union(Set(s.job)) else s.exact) }
  action verifyCopy = all { s.stage == "copy-read",
    s' = if (s.present.contains(s.job) and s.exact.contains(s.job))
        s.with("copied", s.copied.union(Set(s.job))).with("stage", "page-put")
      else s.with("stage", "failed") }
  action recordPage(creates: bool): bool = all { s.stage == "page-put", s.copied.contains(s.job),
    s.job == 0 or s.pageHistory.contains(0),
    s' = s.with("stage", "page-read")
      .with("pages", if (creates) s.pages.union(Set(s.job)) else s.pages)
      .with("validPages", if (creates and not(s.pages.contains(s.job))) s.validPages.union(Set(s.job)) else s.validPages)
      .with("pageHistory", if (creates) s.pageHistory.union(Set(s.job)) else s.pageHistory) }
  action readPage = all { s.stage == "page-read",
    s' = s.with("stage", if (s.pages.contains(s.job) and s.validPages.contains(s.job))
      (if (s.job == 0) "next-send" else "complete-put") else "failed") }
  action sendNext(commits: bool): bool = all { s.stage == "next-send", s.job == 0,
    s' = s.with("pending", if (commits) s.pending.union(Set(1)) else s.pending)
      .with("stage", if (commits) "ack" else "failed") }
  action receipt(creates: bool): bool = all { s.stage == "complete-put", s.job == 1,
    s.pageHistory == objects,
    s' = s.with("stage", "complete-read")
      .with("completePresent", s.completePresent or creates)
      .with("completeReceipt", s.completeReceipt or (creates and not(s.completePresent)))
      .with("completeWitness", s.completeWitness or (creates and not(s.completePresent))) }
  action readReceipt = all { s.stage == "complete-read",
    s' = s.with("stage", if (s.completePresent and s.completeReceipt) "phase-update" else "failed")
      .with("completionObserved", s.completePresent and s.completeReceipt) }
  action finishBackup = all { s.stage == "phase-update", s.completionObserved,
    s' = s.with("phase", "cleanup").with("stage", "cleanup-send") }
  action sendCleanup(commits: bool): bool = all { s.stage == "cleanup-send",
    s' = s.with("pending", if (commits) s.pending.union(Set(2)) else s.pending)
      .with("stage", if (not(commits)) "failed" else if (s.job == -1) "none" else "ack") }
  // Generation retirement is refined in vetting_generation_retirement;
  // vetting_retention retains the historical DELETE counterexample. Current
  // legacy keys are held. Cycle completion does not mean every ref was backed:
  // missing/changed evidence is audited separately from complete retirement.
  action finishCleanup = all { s.stage == "cleanup-work",
    s' = if (s.completePresent and s.completeReceipt)
      s.with("phase", "complete").with("stage", "ack") else s.with("stage", "failed") }
  action ack = all { s.stage == "ack", s.job != -1,
    s' = s.with("acknowledgments", s.acknowledgments + 1).with("job", -1)
      .with("stage", "none").with("outcome", "acknowledged") }
  // Lost I/O responses preserve the side effect. No failed attempt is acknowledged.
  action loseReply = all {
    Set("start-read", "copy-read", "page-read", "complete-read", "phase-update", "cleanup-send", "ack").contains(s.stage),
    s' = s.with("stage", "failed") }
  action retry = all { s.stage == "failed",
    s' = s.with("pending", if (s.job == -1) s.pending else s.pending.union(Set(s.job)))
      .with("job", -1).with("stage", "none").with("outcome", "retry") }
  action replay(page: int): bool = all { s.seen.contains(page), s.replays < 2,
    s' = s.with("pending", s.pending.union(Set(page))).with("replays", s.replays + 1) }
  // Corruption/lifecycle loss is external; retained receipts are not current byte proof.
  action loseCopy(object: int): bool = all { s.present.contains(object),
    s' = s.with("present", s.present.exclude(Set(object))).with("exact", s.exact.exclude(Set(object))) }
  action corruptCopy(object: int): bool = all { s.present.contains(object),
    s' = s.with("exact", s.exact.exclude(Set(object))) }
  action losePage(page: int): bool = all { s.pages.contains(page),
    s' = s.with("pages", s.pages.exclude(Set(page))).with("validPages", s.validPages.exclude(Set(page))) }
  action loseCompletion = all { s.completePresent,
    s' = s.with("completePresent", false).with("completeReceipt", false) }
  action beginRestore(object: int): bool = all { objects.contains(object),
    Set("none", "done").contains(s.restoreStage), s.restoreAttempts < 3,
    s' = s.with("selected", object).with("restoreStage", "chain")
      .with("restoreAttempts", s.restoreAttempts + 1).with("restoreOutcome", "pending") }
  action restore(chainMatches: bool, totalsMatch: bool, uniqueObject: bool): bool = all { s.restoreStage == "chain",
    s' = if (s.completePresent and s.completeReceipt and s.validPages == objects
      and chainMatches and totalsMatch and uniqueObject) s.with("restoreStage", "source-read")
      else s.with("restoreStage", "done").with("restoreOutcome", "refused") }
  action readRestoreSource = all { s.restoreStage == "source-read",
    s' = if (s.present.contains(s.selected) and s.exact.contains(s.selected))
      s.with("restoreStage", "put") else s.with("restoreStage", "done").with("restoreOutcome", "refused") }
  action putRestore(creates: bool): bool = all { s.restoreStage == "put",
    s' = s.with("restoreStage", "readback")
      .with("destinations", if (creates) s.destinations.union(Set(s.selected)) else s.destinations)
      .with("exactDestinations", if (creates and not(s.destinations.contains(s.selected)))
        s.exactDestinations.union(Set(s.selected)) else s.exactDestinations) }
  action readRestore = all { s.restoreStage == "readback",
    s' = s.with("restoreStage", "done")
      .with("restored", if (s.destinations.contains(s.selected) and s.exactDestinations.contains(s.selected))
        s.restored.union(Set(s.selected)) else s.restored)
      .with("restoreOutcome", if (s.destinations.contains(s.selected) and s.exactDestinations.contains(s.selected))
        "success" else "refused") }
  action loseRestoreReply = all { s.restoreStage == "readback",
    s' = s.with("restoreStage", "done").with("restoreOutcome", "failed-after-put") }
  action conflictingDestination(object: int): bool = all { objects.contains(object),
    not(s.destinations.contains(object)),
    s' = s.with("destinations", s.destinations.union(Set(object))) }
  action step = {
    nondet page = jobs.oneOf()
    nondet object = objects.oneOf()
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    nondet c = Set(false, true).oneOf()
    any { start, putStart(a), readStart, resume, deliver(page), loadStart, loadPage,
      copy(a), verifyCopy, recordPage(a), readPage, sendNext(a), receipt(a), readReceipt,
      finishBackup, sendCleanup(a), finishCleanup, ack, loseReply, retry, replay(page),
      loseCopy(object), corruptCopy(object), losePage(object), loseCompletion,
      beginRestore(object), restore(a, b, c),
      readRestoreSource, putRestore(a), readRestore, loseRestoreReply,
      conflictingDestination(object), s' = s }
  }
  val invariant = all {
    s.pages.subseteq(s.pageHistory), s.pageHistory.subseteq(s.copied),
    s.exact.subseteq(s.present), s.validPages.subseteq(s.pages),
    s.completePresent implies s.completeWitness,
    s.completeReceipt implies s.completePresent and s.completeWitness,
    s.restored.subseteq(s.exactDestinations), s.exactDestinations.subseteq(s.destinations),
    s.restored.subseteq(s.copied), s.deliveries <= 6, s.replays <= 2,
    s.acknowledgments <= s.deliveries, s.phase != "idle" implies s.day == 1 }

  run replayDoesNotAdvanceCursorTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack).then(replay(0))
    .expect(cursor == 1 and s.pages == Set(0) and invariant)
  run noConcurrentCycleTest = init.then(start).then(start.fail())
  run incompleteSnapshotCannotRestoreTest = init.then(start).then(putStart(true)).then(readStart)
    .then(beginRestore(0)).then(restore(true, true, true))
    .expect(s.restoreOutcome == "refused" and s.destinations == Set())
  run restoreVerifiedChainTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(finishBackup).then(sendCleanup(true)).then(ack).then(deliver(2)).then(finishCleanup).then(ack)
    .then(beginRestore(1)).then(restore(true, true, true)).then(readRestoreSource)
    .then(putRestore(true)).then(readRestore).expect(s.restored == Set(1) and invariant)
  run duplicateObjectRefusedTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(beginRestore(1)).then(restore(true, true, false))
    .expect(s.restoreOutcome == "refused" and s.destinations == Set())
  run committedCopyLostReplyIsReusableTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(loseReply).then(retry)
    .expect(s.present == Set(0) and s.copied == Set()).then(deliver(0)).then(loadStart)
    .then(loadPage).then(copy(false)).then(verifyCopy).expect(s.copied == Set(0) and invariant)
  run committedPageLostReplyReusesReceiptTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(loseReply).then(retry).then(deliver(0)).then(loadStart)
    .then(loadPage).expect(s.stage == "next-send" and s.pages == Set(0) and invariant)
  run successorEnqueueBeforeLostAckTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(loseReply).then(retry)
    .expect(s.pending == Set(0, 1) and s.acknowledgments == 0 and invariant)
  run completionExistsBeforeD1PhaseChangeTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(loseReply).then(retry)
    .expect(s.completePresent and s.phase == "backup").then(resume).then(readReceipt)
    .then(finishBackup).expect(s.phase == "cleanup" and invariant)
  run cleanupEnqueueFailureKeepsCommittedPhaseTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(finishBackup).then(sendCleanup(false)).then(retry).expect(s.phase == "cleanup")
    .then(deliver(1)).expect(s.stage == "cleanup-send").then(sendCleanup(true)).then(ack)
    .expect(s.pending == Set(2) and invariant)
  run stalePageAfterCompleteOnlyAcknowledgesTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(finishBackup).then(sendCleanup(true)).then(ack).then(deliver(2)).then(finishCleanup).then(ack)
    .then(replay(0)).then(deliver(0)).then(ack).expect(s.phase == "complete" and s.acknowledgments == 4)
  run restoreCommitCanPrecedeFailedReadbackTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(beginRestore(0)).then(restore(true, true, true)).then(readRestoreSource)
    .then(putRestore(true)).then(loseRestoreReply)
    .expect(s.destinations == Set(0) and s.restored == Set() and s.restoreOutcome == "failed-after-put")
    .then(beginRestore(0)).then(restore(true, true, true)).then(readRestoreSource)
    .then(putRestore(false)).then(readRestore).expect(s.restored == Set(0) and invariant)
  run conflictingRestoreDestinationIsNotOverwrittenTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(conflictingDestination(0)).then(beginRestore(0)).then(restore(true, true, true))
    .then(readRestoreSource).then(putRestore(true)).then(readRestore)
    .expect(s.restoreOutcome == "refused" and s.destinations == Set(0) and s.exactDestinations == Set())
  run missingCurrentCopyRefusesRestoreTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt).then(loseCopy(1))
    .then(beginRestore(1)).then(restore(true, true, true)).then(readRestoreSource)
    .expect(s.restoreOutcome == "refused" and s.destinations == Set() and invariant)
  run missingCurrentPageRefusesRestoreTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt).then(losePage(0))
    .then(beginRestore(1)).then(restore(true, true, true))
    .expect(s.restoreOutcome == "refused" and s.destinations == Set() and invariant)
  run committedStartResumesWithoutAnotherCycleTest = init.then(start).then(putStart(true))
    .then(loseReply).then(retry).then(resume).then(readStart)
    .expect(s.phase == "backup" and s.pending == Set(0) and invariant)
  run corruptCurrentCopyRefusesRestoreTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt).then(corruptCopy(1))
    .then(beginRestore(1)).then(restore(true, true, true)).then(readRestoreSource)
    .expect(s.present.contains(1) and s.restoreOutcome == "refused" and s.destinations == Set())
  run missingCompletionKeepsCleanupIncompleteTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(finishBackup).then(sendCleanup(true)).then(ack).then(loseCompletion)
    .then(deliver(2)).then(finishCleanup).then(retry)
    .expect(s.phase == "cleanup" and s.pending == Set(2) and invariant)
  run completionReadAuthorizesPhaseBeforeLaterLossTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt).then(loseCompletion)
    .then(finishBackup).then(sendCleanup(true)).then(ack).then(deliver(2)).then(finishCleanup).then(retry)
    .expect(s.phase == "cleanup" and not(s.completePresent) and invariant)
  run cleanupCommitBeforeLostAcknowledgmentTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(finishBackup).then(sendCleanup(true)).then(ack).then(deliver(2)).then(finishCleanup)
    .then(loseReply).then(retry).expect(s.phase == "complete" and s.acknowledgments == 2)
    .then(deliver(2)).then(ack).expect(s.acknowledgments == 3 and invariant)
  run receiptRetainedAfterD1PhaseFailureTest = init.then(start).then(putStart(true)).then(readStart)
    .then(deliver(0)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(sendNext(true)).then(ack)
    .then(deliver(1)).then(loadStart).then(loadPage).then(copy(true)).then(verifyCopy)
    .then(recordPage(true)).then(readPage).then(receipt(true)).then(readReceipt)
    .then(loseReply).then(retry).expect(s.phase == "backup" and s.completePresent)
    .then(deliver(1)).then(loadStart).then(loadPage).then(receipt(false)).then(readReceipt)
    .then(finishBackup).expect(s.phase == "cleanup" and invariant)
}

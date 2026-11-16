// @source scripts/sync-cycle-index.ts
// @evidence scripts/cycle-index-publication.test.ts
// Source-only, unexecuted: one prior pair, one proposed pair, two writes and
// two attempts. Renames are local commit boundaries; readers do not share the
// writer guard, and process death between renames is not claimed atomic.
module cycle_snapshot_publication {
  var s: { phase: str, guard: str, priorTree: int, priorPromotion: int,
    tree: int, promotion: int, stagedTree: bool, promotionWorkspace: bool,
    backupTree: bool, backupPromotion: bool, pending: int, failed: bool,
    recoveryFailed: bool, cleanupFailed: bool, committed: bool, result: str,
    checkPassed: bool, externalLoss: bool, attempt: int, debris: bool }
  action init = s' = { phase: "idle", guard: "none", priorTree: 1, priorPromotion: 1,
    tree: 1, promotion: 1, stagedTree: false, promotionWorkspace: false,
    backupTree: false, backupPromotion: false, pending: 0, failed: false,
    recoveryFailed: false, cleanupFailed: false, committed: false, result: "none",
    checkPassed: false, externalLoss: false, attempt: 1, debris: false }
  action noPriorTree = all { s.phase == "idle", s.attempt == 1,
    s' = s.with("tree", 0).with("priorTree", 0) }
  action noPriorPromotion = all { s.phase == "idle", s.attempt == 1,
    s' = s.with("promotion", 0).with("priorPromotion", 0) }
  action start = all { s.phase == "idle", s.guard == "none",
    s' = s.with("guard", "held").with("phase", "staging").with("stagedTree", true)
      .with("promotionWorkspace", true) }
  action launchWrites = all { s.phase == "staging",
    s' = s.with("phase", "writing").with("pending", 2) }
  action stagePreparationFailure = all { s.phase == "staging",
    s' = s.with("phase", "failed").with("failed", true).with("promotionWorkspace", false) }
  action finishWrite(ok: bool): bool = all { s.phase == "writing", s.pending > 0,
    s' = s.with("pending", s.pending - 1).with("failed", s.failed or not(ok))
      .with("phase", if (s.pending > 1) "writing" else if (s.failed or not(ok)) "failed" else "metadata") }
  action stageMetadata(ok: bool): bool = all { s.phase == "metadata",
    s' = s.with("phase", if (ok) "staged" else "failed").with("failed", not(ok)) }
  action moveTree(ok: bool): bool = all { s.phase == "staged",
    s' = if (ok) s.with("tree", 0).with("backupTree", s.priorTree != 0).with("phase", "tree-moved")
      else s.with("failed", true).with("phase", "failed") }
  action movePromotion(ok: bool): bool = all { s.phase == "tree-moved",
    s' = if (ok) s.with("promotion", 0).with("backupPromotion", s.priorPromotion != 0).with("phase", "ready")
      else s.with("failed", true).with("phase", "failed") }
  action activateTree(ok: bool): bool = all { s.phase == "ready",
    s' = if (ok) s.with("tree", 2).with("stagedTree", false).with("phase", "tree-active")
      else s.with("failed", true).with("phase", "failed") }
  action activatePromotion(ok: bool): bool = all { s.phase == "tree-active",
    s' = if (ok) s.with("promotion", 2).with("committed", true).with("phase", "cleanup")
      else s.with("failed", true).with("phase", "failed") }
  action beginRecovery = all { s.phase == "failed", s.pending == 0,
    s' = s.with("phase", "undo-tree") }
  action undoTree(ok: bool): bool = all { s.phase == "undo-tree",
    s' = s.with("phase", "restore-promotion")
      .with("tree", if (s.tree == 2 and ok) 0 else s.tree)
      .with("stagedTree", s.stagedTree or (s.tree == 2 and ok))
      .with("recoveryFailed", s.tree == 2 and not(ok)) }
  action restorePromotion(ok: bool): bool = all { s.phase == "restore-promotion",
    s' = s.with("phase", "restore-tree")
      .with("promotion", if (s.backupPromotion and ok) s.priorPromotion else s.promotion)
      .with("backupPromotion", s.backupPromotion and not(ok))
      .with("recoveryFailed", s.recoveryFailed or (s.backupPromotion and not(ok))) }
  action restoreTree(ok: bool): bool = {
    val restored = s.backupTree and ok and s.tree == 0
    all { s.phase == "restore-tree",
      s' = s.with("phase", "recovered")
        .with("tree", if (restored) s.priorTree else s.tree)
        .with("backupTree", s.backupTree and not(restored))
        .with("recoveryFailed", s.recoveryFailed or (s.backupTree and not(restored))) }
  }
  action endRecovery = all { s.phase == "recovered",
    s' = if (s.recoveryFailed) s.with("phase", "done").with("guard", "retained").with("result", "failure")
      else s.with("phase", "cleanup") }
  action cleanupStages(ok: bool): bool = all { s.phase == "cleanup",
    s' = s.with("phase", "cleanup-backup").with("cleanupFailed", not(ok))
      .with("stagedTree", s.stagedTree and not(ok)) }
  action cleanupBackup(ok: bool): bool = all { s.phase == "cleanup-backup",
    s' = s.with("phase", "cleanup-promotion")
      .with("cleanupFailed", s.cleanupFailed or (s.committed and s.backupTree and not(ok)))
      .with("backupTree", s.backupTree and not(s.committed and ok)) }
  action cleanupPromotion(ok: bool): bool = all { s.phase == "cleanup-promotion",
    s' = s.with("phase", "unlock").with("cleanupFailed", s.cleanupFailed or (s.promotionWorkspace and not(ok)))
      .with("promotionWorkspace", s.promotionWorkspace and not(ok))
      .with("backupPromotion", s.backupPromotion and not(ok)) }
  action releaseGuard(ok: bool): bool = all { s.phase == "unlock",
    s' = s.with("phase", "done").with("guard", if (ok) "none" else "retained")
      .with("cleanupFailed", s.cleanupFailed or not(ok))
      .with("result", if (s.committed and not(s.failed) and not(s.cleanupFailed) and ok) "success" else "failure") }
  action retry = all { s.phase == "done", s.guard == "none", s.failed,
    not(s.committed), not(s.recoveryFailed), s.attempt == 1,
    s.tree == s.priorTree, s.promotion == s.priorPromotion,
    s' = s.with("phase", "idle").with("attempt", 2).with("failed", false)
      .with("cleanupFailed", false).with("result", "none")
      .with("debris", s.debris or s.stagedTree or s.promotionWorkspace)
      .with("stagedTree", false).with("promotionWorkspace", false) }
  action crash = all { s.guard == "held", s.pending == 0,
    s' = s.with("guard", "retained").with("phase", "crashed").with("result", "failure") }
  // External deletion after a completed build is outside the publisher. Check
  // mode validates source/promotion and does not attest the generated tree.
  action externalTreeLoss = all { s.result == "success", s.phase == "done",
    s' = s.with("tree", 0).with("externalLoss", true) }
  action checkOnly = all { s.promotion == 2, s' = s.with("checkPassed", true) }
  action step = {
    nondet ok = Set(false, true).oneOf()
    any { noPriorTree, noPriorPromotion, start, launchWrites, stagePreparationFailure, finishWrite(ok), stageMetadata(ok),
      moveTree(ok), movePromotion(ok), activateTree(ok), activatePromotion(ok), beginRecovery,
      undoTree(ok), restorePromotion(ok), restoreTree(ok), endRecovery, cleanupStages(ok),
      cleanupBackup(ok), cleanupPromotion(ok), releaseGuard(ok), retry, crash, externalTreeLoss, checkOnly, s' = s }
  }
  val invariant = all {
    s.pending > 0 implies s.phase == "writing",
    s.result == "success" and not(s.externalLoss) implies s.committed and s.tree == 2 and s.promotion == 2 and s.guard == "none",
    s.committed and not(s.externalLoss) implies s.tree == 2 and s.promotion == 2,
    s.phase == "done" and s.failed and not(s.recoveryFailed) implies s.tree == s.priorTree and s.promotion == s.priorPromotion,
    s.recoveryFailed implies s.guard == "held" or s.guard == "retained",
    s.backupTree implies s.priorTree != 0,
    s.backupPromotion implies s.priorPromotion != 0 }
  run successfulTreeSwapTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true))
    .then(activatePromotion(true)).then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.result == "success")
  run failedRenameRestoresOldTreeTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(false))
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.tree == 1 and s.promotion == 1)
  run checkOnlyDoesNotAttestPublicTreeTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true))
    .then(activatePromotion(true)).then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true))
    .then(externalTreeLoss).then(checkOnly).expect(s.checkPassed and s.tree == 0)
  run failedWriteMustDrainSiblingsTest = init.then(start).then(launchWrites).then(finishWrite(false)).then(beginRecovery.fail())
  run partialStagingPreparationKeepsPriorPairTest = init.then(start).then(stagePreparationFailure)
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.tree == 1 and s.promotion == 1)
  run drainedFailureLeavesPriorPairTest = init.then(start).then(launchWrites).then(finishWrite(false)).then(finishWrite(true))
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.tree == 1 and s.promotion == 1)
  run failedMetadataLeavesPriorPairTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(false)).then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.tree == 1 and s.promotion == 1)
  run failedOldTreeMoveKeepsPriorPairTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(false)).then(beginRecovery).then(undoTree(true))
    .then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery).expect(s.tree == 1 and s.promotion == 1)
  run failedOldPromotionMoveRestoresTreeTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(false)).then(beginRecovery).then(undoTree(true))
    .then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery).expect(s.tree == 1 and s.promotion == 1)
  run failedPromotionCommitRestoresBothTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(false))
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.tree == 1 and s.promotion == 1)
  run failedTreeRetractionRetainsRecoveryInputsTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(false))
    .then(beginRecovery).then(undoTree(false)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .expect(s.tree == 2 and s.backupTree and s.guard == "retained")
  run failedPromotionRestoreRetainsBackupTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(false))
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(false)).then(restoreTree(true)).then(endRecovery)
    .expect(s.backupPromotion and s.guard == "retained")
  run failedTreeRestoreRetainsBackupTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(false))
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(false)).then(endRecovery)
    .expect(s.backupTree and s.guard == "retained")
  run committedCleanupFailureDoesNotUndoPairTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(false)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.tree == 2 and s.promotion == 2 and s.result == "failure")
  run committedBackupCleanupFailureRetainsOldCopyTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(true)).then(cleanupBackup(false)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.backupTree and s.result == "failure")
  run committedGuardCleanupFailureBlocksNextWriterTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(false)).expect(s.guard == "retained").then(start.fail())
  run secondPublisherCannotEnterHeldGuardTest = init.then(start).then(start.fail())
  run crashAfterOldTreeMoveRetainsOldDataTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(crash).expect(s.backupTree and s.guard == "retained")
  run crashBetweenPairCommitsIsNotAtomicTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(crash)
    .expect(s.tree == 2 and s.promotion == 0 and s.backupPromotion and s.guard == "retained")
  run freshPublicTreeCanPublishTest = init.then(noPriorTree).then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.result == "success")
  run firstPromotionCanPublishTest = init.then(noPriorPromotion).then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.result == "success")
  run restoredFailureCanRetryTest = init.then(start).then(launchWrites).then(finishWrite(false)).then(finishWrite(true))
    .then(beginRecovery).then(undoTree(true)).then(restorePromotion(true)).then(restoreTree(true)).then(endRecovery)
    .then(cleanupStages(false)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).then(retry)
    .then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true)).then(stageMetadata(true))
    .then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(true)).then(releaseGuard(true)).expect(s.result == "success" and s.debris)
  run committedPromotionCleanupFailureRetainsBackupTest = init.then(start).then(launchWrites).then(finishWrite(true)).then(finishWrite(true))
    .then(stageMetadata(true)).then(moveTree(true)).then(movePromotion(true)).then(activateTree(true)).then(activatePromotion(true))
    .then(cleanupStages(true)).then(cleanupBackup(true)).then(cleanupPromotion(false)).then(releaseGuard(true))
    .expect(s.backupPromotion and s.promotionWorkspace and s.result == "failure" and s.tree == 2 and s.promotion == 2)

}

// @source scripts/evidence-bundle.mjs
// @source scripts/evidence-contract.mjs
// @source scripts/record-evidence.mjs
// @source scripts/run-e2e.mjs
// @source scripts/run-e2e-phase.mjs
// @evidence scripts/evidence-publication.test.ts
// One prior bundle, one candidate and one possible concurrent valid winner.
// Local rename, transaction state, cleanup and process result are distinct.
// Parser/media validation and real browser/process behavior are abstract inputs.
module evidence_capture {
  var s: { phase: str, transaction: str, buildBound: bool, browserClean: bool,
    complete: bool, current: int, previous: int, backup: bool, staged: bool,
    rootError: str, primary: str, recoveryError: bool, cleanupErrors: Set[str],
    attempted: Set[str], previewStopped: bool, result: str, logged: bool }
  action init = s' = { phase: "new", transaction: "none", buildBound: false,
    browserClean: false, complete: false, current: 1, previous: 1, backup: false,
    staged: false, rootError: "none", primary: "none", recoveryError: false,
    cleanupErrors: Set(), attempted: Set(), previewStopped: false,
    result: "none", logged: false }
  action noPrior = all { s.phase == "new", s' = s.with("current", 0).with("previous", 0) }
  action stage = all { s.phase == "new",
    s' = s.with("phase", "staging").with("transaction", "open").with("staged", true) }
  // The .video setup now belongs to the same owned operation as capture.
  action setupFailure = all { s.phase == "staging",
    s' = s.with("phase", "operation-done").with("rootError", "setup").with("primary", "setup") }
  action capture(clean: bool, bound: bool): bool = all { s.phase == "staging",
    s' = s.with("phase", "browser-cleanup").with("browserClean", clean).with("buildBound", bound)
      .with("rootError", if (clean) "none" else "capture")
      .with("primary", if (clean) "none" else "capture") }
  action closeBrowser(ok: bool): bool = all { s.phase == "browser-cleanup",
    s' = s.with("attempted", s.attempted.union(Set("browser")))
      .with("cleanupErrors", if (ok) s.cleanupErrors else s.cleanupErrors.union(Set("browser")))
      .with("primary", if (not(ok) and s.primary == "none") "browser-close" else s.primary)
      .with("phase", if (ok and s.primary == "none") "captured" else "operation-done") }
  // Caller composition: record-evidence validates before publish. The bare
  // beginEvidenceTransaction API itself does not enforce this precondition.
  action validate(ok: bool): bool = all { s.phase == "captured",
    s' = if (ok and s.browserClean and s.buildBound)
        s.with("phase", "validated").with("complete", true)
      else s.with("phase", "operation-done").with("rootError", "validation").with("primary", "validation") }
  action movePrevious(ok: bool): bool = all { s.phase == "validated", s.complete,
    s' = if (ok) s.with("phase", "swapping").with("backup", s.previous != 0).with("current", 0)
      else s.with("phase", "operation-done").with("rootError", "publication").with("primary", "publication") }
  // No lock is implied. A different publisher can install a valid nonempty
  // directory while this transaction's previous bundle is quarantined.
  action concurrentWinner = all { s.phase == "swapping", s.current == 0,
    s' = s.with("current", 3) }
  action publish(ok: bool): bool = all { s.phase == "swapping", s.transaction == "open",
    s' = if (ok and s.current == 0) s.with("current", 2).with("staged", false)
        .with("transaction", "published").with("phase", "backup-cleanup")
      else s.with("phase", "publication-failed").with("rootError", "publication").with("primary", "publication") }
  action restoreOnError(ok: bool): bool = all { s.phase == "publication-failed",
    s' = if (not(s.backup)) s.with("phase", "operation-done")
      else if (ok and s.current == 0) s.with("phase", "operation-done")
        .with("current", s.previous).with("backup", false)
      else s.with("phase", "operation-done").with("transaction", "recovery-required").with("recoveryError", true) }
  action cleanupBackup(ok: bool): bool = all { s.phase == "backup-cleanup", s.transaction == "published",
    s' = s.with("phase", "operation-done").with("backup", s.backup and not(ok))
      .with("rootError", if (s.backup and not(ok)) "published-cleanup" else s.rootError)
      .with("primary", if (s.backup and not(ok)) "published-cleanup" else s.primary) }
  // Independent cleanup attempts: preview failure never skips transaction abort.
  action stopPreview(ok: bool): bool = all { s.phase == "operation-done",
    s' = s.with("phase", "abort-cleanup").with("attempted", s.attempted.union(Set("preview")))
      .with("previewStopped", ok)
      .with("cleanupErrors", if (ok) s.cleanupErrors else s.cleanupErrors.union(Set("preview")))
      .with("primary", if (not(ok) and s.primary == "none") "preview-stop" else s.primary) }
  action abort(ok: bool): bool = {
    val fails = s.transaction == "open" and not(ok)
    all { s.phase == "abort-cleanup",
      s' = s.with("phase", "done").with("attempted", s.attempted.union(Set("abort")))
        .with("transaction", if (s.transaction == "open" and ok) "aborted" else s.transaction)
        .with("staged", if (s.transaction == "open" and ok) false else s.staged)
        .with("cleanupErrors", if (fails) s.cleanupErrors.union(Set("abort")) else s.cleanupErrors)
        .with("primary", if (fails and s.primary == "none") "abort" else s.primary)
        .with("result", if (s.primary == "none" and not(fails)) "success" else "failure") }
  }
  action retryAbort(ok: bool): bool = all { s.phase == "done", s.transaction == "open",
    s' = s.with("transaction", if (ok) "aborted" else "open").with("staged", not(ok)) }
  action protectedAbort = all { s.phase == "done", s.transaction != "open", s' = s }
  action logSuccess = all { s.phase == "done", s.result == "success", s.transaction == "published",
    s' = s.with("logged", true) }
  action crashBetweenRenames = all { s.phase == "swapping",
    s' = s.with("phase", "interrupted").with("result", "interrupted") }
  action crashAfterPublication = all { s.phase == "backup-cleanup",
    s' = s.with("phase", "interrupted").with("result", "interrupted") }
  action step = {
    nondet a = Set(false, true).oneOf()
    nondet b = Set(false, true).oneOf()
    any { noPrior, stage, setupFailure, capture(a, b), closeBrowser(a), validate(a),
      movePrevious(a), concurrentWinner, publish(a), restoreOnError(a), cleanupBackup(a),
      stopPreview(a), abort(a), retryAbort(a), protectedAbort, logSuccess,
      crashBetweenRenames, crashAfterPublication, s' = s }
  }
  val invariant = all {
    s.current == 2 implies s.complete and s.buildBound and s.browserClean,
    s.current == 0 and s.previous != 0 implies s.backup,
    s.transaction == "published" implies s.current == 2 and not(s.staged),
    s.transaction == "aborted" implies not(s.staged),
    s.transaction == "recovery-required" implies s.backup and s.staged and s.current != 2,
    s.rootError != "none" implies s.primary == s.rootError,
    s.attempted.contains("abort") implies s.attempted.contains("preview"),
    s.logged implies s.result == "success" and s.transaction == "published" and s.previewStopped,
    s.result == "success" implies s.transaction == "published" and s.primary == "none" and s.cleanupErrors == Set() }

  run cleanCaptureTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(true)).then(cleanupBackup(true))
    .then(stopPreview(true)).then(abort(true)).then(logSuccess).expect(s.current == 2 and s.logged and invariant)
  run failedSwapRestoresTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(false)).then(restoreOnError(true))
    .then(stopPreview(true)).then(abort(true)).expect(s.current == 1 and s.result == "failure" and invariant)
  run interruptedSwapIsExplicitTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(crashBetweenRenames)
    .expect(s.current == 0 and s.backup and s.staged and invariant)
  run committedCleanupFailureKeepsNewBundleTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(true)).then(cleanupBackup(false))
    .then(stopPreview(true)).then(abort(true)).expect(s.current == 2 and s.backup
      and s.transaction == "published" and s.primary == "published-cleanup" and invariant)
  run failedRestorationPreservesBothInputsTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(false)).then(restoreOnError(false))
    .then(stopPreview(true)).then(abort(true)).expect(s.current == 0 and s.backup and s.staged
      and s.transaction == "recovery-required" and s.primary == "publication" and s.recoveryError and invariant)
  run concurrentWinnerIsNotOverwrittenTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(concurrentWinner).then(publish(false))
    .then(restoreOnError(true)).then(stopPreview(true)).then(abort(true))
    .expect(s.current == 3 and s.backup and s.staged and s.transaction == "recovery-required" and invariant)
  run previewFailureStillAbortsStagingTest = init.then(stage).then(setupFailure)
    .then(stopPreview(false)).then(abort(true)).expect(s.transaction == "aborted"
      and s.primary == "setup" and s.cleanupErrors == Set("preview") and invariant)
  run captureAndBothFinalizersPreserveFirstErrorTest = init.then(stage).then(capture(false, true))
    .then(closeBrowser(true)).then(stopPreview(false)).then(abort(false))
    .expect(s.primary == "capture" and s.cleanupErrors == Set("preview", "abort") and s.staged and invariant)
  run browserCloseFailurePreventsPublicationTest = init.then(stage).then(capture(true, true))
    .then(closeBrowser(false)).then(stopPreview(true)).then(abort(true))
    .expect(s.current == 1 and s.transaction == "aborted" and s.primary == "browser-close" and invariant)
  run captureFailureSurvivesBrowserCloseFailureTest = init.then(stage).then(capture(false, true))
    .then(closeBrowser(false)).then(stopPreview(true)).then(abort(true))
    .expect(s.primary == "capture" and s.cleanupErrors.contains("browser") and invariant)
  run setupFailureUsesOwnedFinalizersTest = init.then(stage).then(setupFailure)
    .then(stopPreview(true)).then(abort(true)).expect(not(s.staged) and s.attempted == Set("preview", "abort") and invariant)
  run failedAbortRemainsRetryableTest = init.then(stage).then(setupFailure)
    .then(stopPreview(true)).then(abort(false)).expect(s.transaction == "open" and s.staged)
    .then(retryAbort(true)).expect(s.transaction == "aborted" and not(s.staged) and s.result == "failure" and invariant)
  run firstBundleNeedsNoPreviousBackupTest = init.then(noPrior).then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(true)).then(cleanupBackup(true))
    .then(stopPreview(true)).then(abort(true)).then(logSuccess).expect(s.current == 2 and not(s.backup) and invariant)
  run failedPreviousMoveKeepsOldBundleTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(false)).then(stopPreview(true)).then(abort(true))
    .expect(s.current == 1 and not(s.backup) and s.primary == "publication" and invariant)
  action invalidBundle = init.then(stage).then(capture(true, false)).then(closeBrowser(true)).then(validate(true))
  run invalidBundleCannotPublishTest = invalidBundle.then(movePrevious(true).fail())
  run invalidBundleFinalizesFailureTest = invalidBundle.then(stopPreview(true)).then(abort(true))
    .expect(s.current == 1 and s.primary == "validation" and invariant)
  run crashAfterCommitKeepsPublishedStateTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(true)).then(crashAfterPublication)
    .expect(s.current == 2 and s.transaction == "published" and s.backup and invariant)
  run postCommitPreviewFailureCannotLogSuccessTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(true)).then(cleanupBackup(true))
    .then(stopPreview(false)).then(abort(true))
    .expect(s.current == 2 and s.result == "failure" and s.primary == "preview-stop" and invariant).then(logSuccess.fail())
  run protectedAbortDoesNotDeletePublishedBundleTest = init.then(stage).then(capture(true, true)).then(closeBrowser(true))
    .then(validate(true)).then(movePrevious(true)).then(publish(true)).then(cleanupBackup(false))
    .then(stopPreview(true)).then(abort(true)).then(protectedAbort)
    .expect(s.current == 2 and s.backup and s.transaction == "published" and invariant)
}

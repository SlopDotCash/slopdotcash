// @source skills/project-contributor-template/scripts/live-report.mjs
// @evidence scripts/contributor-lock-publication.test.ts
// Source-only, unexecuted. Two live caller identities, one already-dead prior
// owner, three acquisition attempts and one returned handle/tombstone per caller.
// A successful local rename is the commit boundary. Child/process liveness and
// startup exclusion are external premises supplied by contributor_discovery_lock.
module contributor_lock_publication {
  val callers = Set(1, 2)
  type Handle = { published: bool, released: bool, complete: bool }
  val absent = { published: false, released: false, complete: false }
  var s: { phase: str, operation: str, actor: int, attempt: int,
    guard: str, canonical: int, priorDead: bool, candidatePresent: bool,
    candidates: Set[int], stale: bool, ownsStale: bool, staleDamaged: bool,
    handles: int -> Handle, publishedCallers: Set[int], tombstones: Set[int], primary: str,
    secondary: Set[str], committed: bool, rolledBack: bool,
    diagnostic: str, cleanupCanonical: int, allStopped: bool }
  action init = s' = { phase: "idle", operation: "none", actor: 1, attempt: 0,
    guard: "none", canonical: 0, priorDead: false, candidatePresent: false,
    candidates: Set(), stale: false, ownsStale: false, staleDamaged: false,
    handles: callers.mapBy(_ => absent), publishedCallers: Set(), tombstones: Set(), primary: "none",
    secondary: Set(), committed: false, rolledBack: false,
    diagnostic: "none", cleanupCanonical: 0, allStopped: false }
  // A fixed historical owner has no active parent, helper, or child.
  action seedStale = all { s.phase == "idle", s.attempt == 0, s.canonical == 0,
    s' = s.with("canonical", 3).with("priorDead", true) }
  action beginAcquire(actor: int): bool = all {
    s.phase == "idle", s.guard == "none", callers.contains(actor),
    s.attempt < 3, not(s.publishedCallers.contains(actor)),
    s' = s.with("phase", "prepare").with("operation", "acquire")
      .with("actor", actor).with("attempt", s.attempt + 1).with("guard", "acquire")
      .with("primary", "none").with("secondary", Set()).with("committed", false)
      .with("rolledBack", false).with("diagnostic", "none").with("candidatePresent", false)
      .with("ownsStale", false) }
  action prepare(succeeds: bool): bool = all { s.phase == "prepare",
    s' = s.with("candidatePresent", true).with("candidates", s.candidates.union(Set(s.attempt)))
      .with("phase", if (succeeds) "inspect" else "candidate-cleanup")
      .with("primary", if (succeeds) "none" else "prepare") }
  action inspect = all { s.phase == "inspect",
    s' = if (s.canonical == 0) s.with("phase", "publish")
      else if (s.canonical == 3 and s.priorDead) s.with("phase", "quarantine")
      else s.with("phase", "candidate-cleanup").with("primary", "contention") }
  action quarantine(succeeds: bool): bool = all { s.phase == "quarantine",
    s' = if (succeeds) s.with("canonical", 0).with("stale", true).with("ownsStale", true).with("phase", "publish")
      else s.with("primary", "quarantine").with("phase", "candidate-cleanup") }
  action publish(succeeds: bool): bool = all { s.phase == "publish", s.canonical == 0,
    s' = if (succeeds) s.with("canonical", s.actor).with("candidatePresent", false)
        .with("candidates", s.candidates.exclude(Set(s.attempt))).with("committed", true)
        .with("phase", if (s.ownsStale) "stale-cleanup" else "guard-cleanup")
      else s.with("primary", "publish").with("phase", "candidate-cleanup") }
  // Required stale cleanup may partly delete its private tombstone before failing.
  action cleanupStale(succeeds: bool): bool = all { s.phase == "stale-cleanup",
    s' = if (succeeds) s.with("stale", false).with("phase", "guard-cleanup")
      else s.with("staleDamaged", true).with("primary", "stale-cleanup").with("phase", "rollback") }
  // The handle is not published; the held guard excludes every helper startup.
  // Never restore the potentially damaged prior owner's quarantined directory.
  action rollback(succeeds: bool): bool = all { s.phase == "rollback", s.guard == "acquire",
    s.canonical == s.actor, not(s.handles.get(s.actor).published),
    s' = if (succeeds) s.with("canonical", 0).with("candidatePresent", true)
        .with("candidates", s.candidates.union(Set(s.attempt))).with("rolledBack", true)
        .with("phase", "candidate-cleanup")
      else s.with("secondary", s.secondary.union(Set("rollback"))).with("phase", "guard-cleanup") }
  action cleanupCandidate(succeeds: bool): bool = all { s.phase == "candidate-cleanup",
    s.candidatePresent, s.primary != "none",
    s' = s.with("phase", "guard-cleanup")
      .with("candidatePresent", not(succeeds))
      .with("candidates", if (succeeds) s.candidates.exclude(Set(s.attempt)) else s.candidates)
      .with("secondary", if (succeeds) s.secondary else s.secondary.union(Set("candidate-cleanup"))) }
  action cleanupGuard(succeeds: bool): bool = all { s.phase == "guard-cleanup",
    s' = s.with("phase", "finish").with("guard", if (succeeds) "none" else "blocked")
      .with("primary", if (succeeds or s.primary != "none") s.primary else "guard-cleanup")
      .with("secondary", if (succeeds) s.secondary else s.secondary.union(Set("guard-cleanup"))) }
  // Even a committed directory is not a returned handle until guard cleanup succeeds.
  action publishHandle = all { s.phase == "finish", s.operation == "acquire",
    s.primary == "none", s.guard == "none", s.canonical == s.actor,
    s' = s.with("phase", "idle").with("diagnostic", "acquired")
      .with("publishedCallers", s.publishedCallers.union(Set(s.actor)))
      .with("handles", s.handles.set(s.actor, {published: true, released: false, complete: false})) }
  action reportAcquireFailure = all { s.phase == "finish", s.operation == "acquire", s.primary != "none",
    s' = s.with("phase", "idle").with("diagnostic",
      if (s.guard == "blocked") "manual-recovery"
      else if (s.committed and not(s.rolledBack)) "committed-without-handle"
      else if (s.rolledBack) "rolled-back" else "unpublished") }
  action beginRelease(actor: int): bool = {
    val handle = s.handles.get(actor)
    all { s.phase == "idle", s.guard == "none", callers.contains(actor),
      handle.published, not(handle.complete),
      s' = s.with("phase", if (handle.released) "release-cleanup" else "release-rename")
        .with("operation", "release").with("actor", actor).with("guard", "release")
        .with("primary", "none").with("secondary", Set()).with("diagnostic", "none")
        .with("cleanupCanonical", s.canonical) }
  }
  action renameRelease(succeeds: bool): bool = all { s.phase == "release-rename",
    s.canonical == s.actor,
    s' = if (succeeds) s.with("canonical", 0).with("tombstones", s.tombstones.union(Set(s.actor)))
        .with("handles", s.handles.set(s.actor, s.handles.get(s.actor).with("released", true)))
        .with("cleanupCanonical", 0).with("phase", "release-cleanup")
      else s.with("primary", "release-rename").with("phase", "guard-cleanup") }
  // Retry uses only the saved release path, never the current canonical owner.
  action cleanupReleased(succeeds: bool): bool = all { s.phase == "release-cleanup",
    s.handles.get(s.actor).released,
    s' = s.with("phase", "guard-cleanup")
      .with("tombstones", if (succeeds) s.tombstones.exclude(Set(s.actor)) else s.tombstones)
      .with("primary", if (succeeds) "none" else "release-cleanup") }
  action finishRelease = all { s.phase == "finish", s.operation == "release",
    s' = s.with("phase", "idle")
      .with("handles", if (s.primary == "none") s.handles.set(s.actor,
        s.handles.get(s.actor).with("complete", true)) else s.handles)
      .with("diagnostic", if (s.guard == "blocked") "manual-recovery"
        else if (s.primary == "none") "released"
        else if (s.handles.get(s.actor).released) "released-cleanup-incomplete" else "still-owned") }
  // This is outside the application. All affected processes must first stop.
  // A caller whose handle was returned cannot use it after its process stopped.
  // publishedCallers persists: recovery cannot reuse that saved-path identity.
  action confirmAllStopped = all { s.phase == "idle",
    s.guard == "blocked" or s.diagnostic == "committed-without-handle",
    s' = s.with("allStopped", true) }
  action manualRecovery = all { s.phase == "idle", s.allStopped,
    s.guard == "blocked" or s.diagnostic == "committed-without-handle",
    s' = s.with("guard", "none").with("canonical", 0)
      .with("handles", callers.mapBy(_ => absent)).with("allStopped", false)
      .with("diagnostic", "externally-recovered") }
  def mayStart(actor: int): bool = s.guard == "none" and s.canonical == actor
    and s.handles.get(actor).published and not(s.handles.get(actor).released)
  action step = {
    nondet actor = callers.oneOf()
    nondet succeeds = Set(false, true).oneOf()
    any { seedStale, beginAcquire(actor), prepare(succeeds), inspect, quarantine(succeeds),
      publish(succeeds), cleanupStale(succeeds), rollback(succeeds), cleanupCandidate(succeeds),
      cleanupGuard(succeeds), publishHandle, reportAcquireFailure, beginRelease(actor),
      renameRelease(succeeds), cleanupReleased(succeeds), finishRelease,
      confirmAllStopped, manualRecovery, s' = s }
  }
  val invariant = all {
    s.attempt >= 0 and s.attempt <= 3,
    s.phase == "rollback" implies s.guard == "acquire" and not(s.handles.get(s.actor).published),
    s.rolledBack and s.operation == "acquire" implies s.canonical != s.actor,
    s.staleDamaged implies s.canonical != 3,
    s.phase == "release-cleanup" implies s.canonical == s.cleanupCanonical,
    callers.forall(actor => all {
      s.handles.get(actor).published implies s.publishedCallers.contains(actor),
      s.handles.get(actor).released implies not(mayStart(actor)),
      s.handles.get(actor).complete implies s.handles.get(actor).released and not(s.tombstones.contains(actor)),
      mayStart(actor) implies s.canonical == actor and s.guard == "none" }),
    s.diagnostic == "acquired" implies s.handles.get(s.actor).published,
    s.diagnostic == "committed-without-handle" implies s.canonical == s.actor and not(s.handles.get(s.actor).published),
    s.diagnostic == "manual-recovery" implies s.guard == "blocked" }

  run freshAcquisitionPublishesAfterGuardTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).expect(not(mayStart(1))).then(cleanupGuard(true)).then(publishHandle)
    .expect(mayStart(1) and invariant)
  run preparationCleanupPreservesFirstErrorTest = init.then(beginAcquire(1)).then(prepare(false))
    .then(cleanupCandidate(false)).then(cleanupGuard(true)).then(reportAcquireFailure)
    .expect(s.primary == "prepare" and s.candidates == Set(1) and s.canonical == 0 and invariant)
  run contentionCleanupPreservesContentionTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle)
    .then(beginAcquire(2)).then(prepare(true)).then(inspect).then(cleanupCandidate(false))
    .then(cleanupGuard(true)).then(reportAcquireFailure).expect(s.primary == "contention" and mayStart(1))
  run failedQuarantineKeepsDeadOwnerTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(false)).then(cleanupCandidate(true)).then(cleanupGuard(true))
    .then(reportAcquireFailure).expect(s.canonical == 3 and not(s.stale) and invariant)
  run failedPublicationDoesNotRestoreQuarantineTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(true)).then(publish(false)).then(cleanupCandidate(false))
    .then(cleanupGuard(true)).then(reportAcquireFailure).expect(s.canonical == 0 and s.stale and s.primary == "publish")
  run staleCleanupSuccessPublishesHandleTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(true)).then(publish(true)).then(cleanupStale(true))
    .then(cleanupGuard(true)).then(publishHandle).expect(mayStart(1) and not(s.stale) and invariant)
  run failedStaleCleanupRollsBackUnpublishedOwnerTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(true)).then(publish(true)).then(cleanupStale(false))
    .then(rollback(true)).then(cleanupCandidate(true)).then(cleanupGuard(true)).then(reportAcquireFailure)
    .expect(s.canonical == 0 and s.staleDamaged and s.diagnostic == "rolled-back" and invariant)
  run rollbackPermitsSameCallerRetryTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(true)).then(publish(true)).then(cleanupStale(false))
    .then(rollback(true)).then(cleanupCandidate(true)).then(cleanupGuard(true)).then(reportAcquireFailure)
    .then(beginAcquire(1)).then(prepare(true)).then(inspect).then(publish(true))
    .then(cleanupGuard(true)).then(publishHandle).expect(mayStart(1) and invariant)
  run rollbackCandidateCleanupKeepsOriginalErrorTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(true)).then(publish(true)).then(cleanupStale(false))
    .then(rollback(true)).then(cleanupCandidate(false)).then(cleanupGuard(true)).then(reportAcquireFailure)
    .expect(s.primary == "stale-cleanup" and s.candidates == Set(1) and s.canonical == 0 and invariant)
  run failedRollbackReportsCommittedOwnerTest = init.then(seedStale).then(beginAcquire(1)).then(prepare(true))
    .then(inspect).then(quarantine(true)).then(publish(true)).then(cleanupStale(false))
    .then(rollback(false)).then(cleanupGuard(true)).then(reportAcquireFailure)
    .expect(s.primary == "stale-cleanup" and s.canonical == 1 and s.diagnostic == "committed-without-handle"
      and not(mayStart(1)) and invariant)
  run guardFailureAfterPublicationRequiresRecoveryTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(false)).then(reportAcquireFailure)
    .expect(s.canonical == 1 and not(mayStart(1)) and invariant).then(beginAcquire(2).fail())
  run guardFailureKeepsPreparationErrorTest = init.then(beginAcquire(1)).then(prepare(false))
    .then(cleanupCandidate(false)).then(cleanupGuard(false)).then(reportAcquireFailure)
    .expect(s.primary == "prepare" and s.diagnostic == "manual-recovery" and invariant)
  run cleanReleaseCompletesHandleTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(true)).expect(not(mayStart(1))).then(cleanupReleased(true))
    .then(cleanupGuard(true)).then(finishRelease).expect(s.handles.get(1).complete and invariant)
  run failedReleaseRenameKeepsOwnerTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(false)).then(cleanupGuard(true)).then(finishRelease)
    .expect(mayStart(1) and s.diagnostic == "still-owned" and invariant)
  run releaseCleanupFailureStillClosesHandleTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(true)).then(cleanupReleased(false)).then(cleanupGuard(true)).then(finishRelease)
    .expect(s.canonical == 0 and s.handles.get(1).released and not(s.handles.get(1).complete)
      and not(mayStart(1)) and s.tombstones == Set(1) and invariant)
  run releaseRetryCannotTouchSuccessorTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(true)).then(cleanupReleased(false)).then(cleanupGuard(true)).then(finishRelease)
    .then(beginAcquire(2)).then(prepare(true)).then(inspect).then(publish(true)).then(cleanupGuard(true))
    .then(publishHandle).then(beginRelease(1)).then(cleanupReleased(true)).then(cleanupGuard(true))
    .then(finishRelease).expect(s.canonical == 2 and mayStart(2) and s.handles.get(1).complete and invariant)
  run repeatedReleaseCleanupFailureKeepsSuccessorTest = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(true)).then(cleanupReleased(false)).then(cleanupGuard(true)).then(finishRelease)
    .then(beginAcquire(2)).then(prepare(true)).then(inspect).then(publish(true)).then(cleanupGuard(true))
    .then(publishHandle).then(beginRelease(1)).then(cleanupReleased(false)).then(cleanupGuard(true))
    .then(finishRelease).expect(s.canonical == 2 and mayStart(2) and s.tombstones == Set(1) and invariant)
  action releaseGuardFailure = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(true)).then(cleanupReleased(true)).then(cleanupGuard(false)).then(finishRelease)
  run releaseGuardFailureBlocksSuccessorAndRetryTest = releaseGuardFailure
    .expect(s.handles.get(1).released and not(s.handles.get(1).complete) and invariant)
    .then(beginRelease(1).fail())
  run releaseGuardFailureBlocksSuccessorTest = releaseGuardFailure.then(beginAcquire(2).fail())
  action acquireGuardFailure = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(false)).then(reportAcquireFailure)
  run manualGuardRecoveryIsExternalTest = acquireGuardFailure.then(manualRecovery.fail())
  run stoppedOwnerAllowsManualGuardRecoveryTest = acquireGuardFailure.then(confirmAllStopped).then(manualRecovery)
    .then(beginAcquire(2)).then(prepare(true)).then(inspect).then(publish(true))
    .then(cleanupGuard(true)).then(publishHandle).expect(mayStart(2) and invariant)
  action recoveredWithDebris = init.then(beginAcquire(1)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle).then(beginRelease(1))
    .then(renameRelease(true)).then(cleanupReleased(false)).then(cleanupGuard(false)).then(finishRelease)
    .then(confirmAllStopped).then(manualRecovery)
  run manualRecoveryRetainsDebrisWithoutReusingIdentityTest = recoveredWithDebris
    .expect(s.tombstones == Set(1)).then(beginAcquire(1).fail())
  run successorAfterManualRecoveryRetainsDebrisTest = recoveredWithDebris
    .then(beginAcquire(2)).then(prepare(true)).then(inspect)
    .then(publish(true)).then(cleanupGuard(true)).then(publishHandle)
    .expect(s.canonical == 2 and s.tombstones == Set(1) and invariant)
}

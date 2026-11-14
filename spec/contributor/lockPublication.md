# Discovery lock directory publication and release

PRD sections 4 and 12. This unit refines the acquisition and release of the
[discovery lock](./discoveryLock.md) directory
(`skills/project-contributor-template/scripts/live-report.mjs`, legacy
`contributor_lock_publication` with source test
`scripts/contributor-lock-publication.test.ts`). A successful local rename is
the commit boundary. Child and process liveness and startup exclusion are
premises supplied by the discovery lock. Two caller identities compete, and
a prior owner whose processes are dead may have left the canonical lock
directory (identity 3).

## Story: Return a lock handle only after the whole acquisition is clean

### Acquisition prepares a candidate, quarantines a dead owner, and publishes by rename

A candidate directory is prepared under a transition guard. If the canonical
directory belongs to a dead owner it is quarantined first; any other owner is
contention. Publication renames the candidate into place. When the caller
quarantined a stale owner, that tombstone must be removed; if removal fails
the unpublished acquisition is rolled back, and the possibly damaged prior
directory is never restored. A committed directory is not a returned handle
until the guard is removed; a guard that cannot be removed blocks everyone
until manual recovery.

```quint
type LockOp = NoOp | Acquiring | Releasing
type LockStep = LockIdle | Prepare | Inspect | Quarantine | PublishStep | StaleCleanup | Rollback | CandidateCleanup
  | GuardCleanup | Finish | ReleaseRename | ReleaseCleanup
type PubGuard = PubNone | PubAcquire | PubRelease | PubBlocked
type LockError = NoLockError | PrepareError | ContentionError | QuarantineError | PublishError | StaleCleanupError
  | GuardCleanupError | ReleaseRenameError | ReleaseCleanupError
type Diagnostic = NoDiagnostic | Acquired | CommittedWithoutHandle | RolledBackAcquisition | Unpublished
  | ManualRecoveryNeeded | ReleasedClean | ReleasedCleanupIncomplete | StillOwned | ExternallyRecovered
type Handle = { caller: int, published: bool, released: bool, complete: bool }
type LockPublication = { step: LockStep, op: LockOp, actor: int, attempt: int, guard: PubGuard, canonical: int,
  priorDead: bool, candidatePresent: bool, stale: bool, ownsStale: bool, staleDamaged: bool,
  handles: List[Handle], tombstones: List[int], primary: LockError, secondaryFailures: int, committed: bool,
  rolledBack: bool, diagnostic: Diagnostic, cleanupCanonical: int, allStopped: bool }
pure val priorOwner = 3
pure val noHandle: Handle = { caller: 0, published: false, released: false, complete: false }
pure val initial: LockPublication = { step: LockIdle, op: NoOp, actor: 1, attempt: 0, guard: PubNone, canonical: 0,
  priorDead: false, candidatePresent: false, stale: false, ownsStale: false, staleDamaged: false,
  handles: List({ ...noHandle, caller: 1 }, { ...noHandle, caller: 2 }), tombstones: List(), primary: NoLockError,
  secondaryFailures: 0, committed: false, rolledBack: false, diagnostic: NoDiagnostic, cleanupCanonical: 0, allStopped: false }
pure def handleOf(p: LockPublication, caller: int): Handle = p.handles.select(h => h.caller == caller).nthOr(0, noHandle)
pure def setHandle(p: LockPublication, caller: int, h: Handle): List[Handle] =
  p.handles.listMap(x => if (x.caller == caller) h else x)
pure def mayStart(p: LockPublication, caller: int): bool = p.guard == PubNone and p.canonical == caller
  and handleOf(p, caller).published and not(handleOf(p, caller).released)
pure def canSeedStale(p: LockPublication): bool = p.step == LockIdle and p.attempt == 0 and p.canonical == 0 and not(p.priorDead)
pure def seedStale(p: LockPublication): LockPublication = { ...p, canonical: priorOwner, priorDead: true }
pure def canBeginAcquire(p: LockPublication, caller: int): bool = p.step == LockIdle and p.guard == PubNone
  and (caller == 1 or caller == 2) and not(handleOf(p, caller).published) and p.attempt < 9007199254740000
pure def beginAcquire(p: LockPublication, caller: int): LockPublication = { ...p, step: Prepare, op: Acquiring, actor: caller,
  attempt: p.attempt + 1, guard: PubAcquire, primary: NoLockError, secondaryFailures: 0, committed: false, rolledBack: false,
  diagnostic: NoDiagnostic, candidatePresent: false, ownsStale: false }
pure def canPrepare(p: LockPublication): bool = p.step == Prepare
pure def prepare(p: LockPublication, succeeds: bool): LockPublication = { ...p, candidatePresent: true,
  step: if (succeeds) Inspect else CandidateCleanup, primary: if (succeeds) NoLockError else PrepareError }
pure def canInspect(p: LockPublication): bool = p.step == Inspect
pure def inspect(p: LockPublication): LockPublication =
  if (p.canonical == 0) { ...p, step: PublishStep }
  else if (p.canonical == priorOwner and p.priorDead) { ...p, step: Quarantine }
  else { ...p, step: CandidateCleanup, primary: ContentionError }
pure def canQuarantine(p: LockPublication): bool = p.step == Quarantine
pure def quarantine(p: LockPublication, succeeds: bool): LockPublication =
  if (succeeds) { ...p, canonical: 0, stale: true, ownsStale: true, step: PublishStep }
  else { ...p, primary: QuarantineError, step: CandidateCleanup }
pure def canPublish(p: LockPublication): bool = p.step == PublishStep and p.canonical == 0
pure def publish(p: LockPublication, succeeds: bool): LockPublication =
  if (succeeds) { ...p, canonical: p.actor, candidatePresent: false, committed: true,
    step: if (p.ownsStale) StaleCleanup else GuardCleanup }
  else { ...p, primary: PublishError, step: CandidateCleanup }
pure def canCleanupStale(p: LockPublication): bool = p.step == StaleCleanup
pure def cleanupStale(p: LockPublication, succeeds: bool): LockPublication =
  if (succeeds) { ...p, stale: false, step: GuardCleanup }
  else { ...p, staleDamaged: true, primary: StaleCleanupError, step: Rollback }
pure def canRollback(p: LockPublication): bool = p.step == Rollback and p.guard == PubAcquire
  and p.canonical == p.actor and not(handleOf(p, p.actor).published)
pure def rollback(p: LockPublication, succeeds: bool): LockPublication =
  if (succeeds) { ...p, canonical: 0, candidatePresent: true, rolledBack: true, step: CandidateCleanup }
  else { ...p, secondaryFailures: p.secondaryFailures + 1, step: GuardCleanup }
pure def canCleanupCandidate(p: LockPublication): bool = p.step == CandidateCleanup and p.candidatePresent and p.primary != NoLockError
pure def cleanupCandidate(p: LockPublication, succeeds: bool): LockPublication = { ...p, step: GuardCleanup,
  candidatePresent: not(succeeds), secondaryFailures: if (succeeds) p.secondaryFailures else p.secondaryFailures + 1 }
pure def canCleanupGuard(p: LockPublication): bool = p.step == GuardCleanup
pure def cleanupGuard(p: LockPublication, succeeds: bool): LockPublication = { ...p, step: Finish,
  guard: if (succeeds) PubNone else PubBlocked,
  primary: if (succeeds or p.primary != NoLockError) p.primary else GuardCleanupError,
  secondaryFailures: if (succeeds) p.secondaryFailures else p.secondaryFailures + 1 }
pure def canPublishHandle(p: LockPublication): bool = p.step == Finish and p.op == Acquiring
  and p.primary == NoLockError and p.guard == PubNone and p.canonical == p.actor
pure def publishHandle(p: LockPublication): LockPublication = { ...p, step: LockIdle, diagnostic: Acquired,
  handles: setHandle(p, p.actor, { caller: p.actor, published: true, released: false, complete: false }) }
pure def canReportAcquireFailure(p: LockPublication): bool = p.step == Finish and p.op == Acquiring and p.primary != NoLockError
pure def reportAcquireFailure(p: LockPublication): LockPublication = { ...p, step: LockIdle,
  diagnostic: if (p.guard == PubBlocked) ManualRecoveryNeeded
    else if (p.committed and not(p.rolledBack)) CommittedWithoutHandle
    else if (p.rolledBack) RolledBackAcquisition else Unpublished }
```

### Release renames to a private tombstone and a retry uses only the saved path

```quint
pure def canBeginRelease(p: LockPublication, caller: int): bool = p.step == LockIdle and p.guard == PubNone
  and (caller == 1 or caller == 2) and handleOf(p, caller).published and not(handleOf(p, caller).complete)
pure def beginRelease(p: LockPublication, caller: int): LockPublication =
  { ...p, step: if (handleOf(p, caller).released) ReleaseCleanup else ReleaseRename, op: Releasing, actor: caller,
    guard: PubRelease, primary: NoLockError, secondaryFailures: 0, diagnostic: NoDiagnostic, cleanupCanonical: p.canonical }
pure def canRenameRelease(p: LockPublication): bool = p.step == ReleaseRename and p.canonical == p.actor
pure def renameRelease(p: LockPublication, succeeds: bool): LockPublication =
  if (succeeds) { ...p, canonical: 0, tombstones: p.tombstones.append(p.actor), cleanupCanonical: 0, step: ReleaseCleanup,
    handles: setHandle(p, p.actor, { ...handleOf(p, p.actor), released: true }) }
  else { ...p, primary: ReleaseRenameError, step: GuardCleanup }
pure def canCleanupReleased(p: LockPublication): bool = p.step == ReleaseCleanup and handleOf(p, p.actor).released
pure def cleanupReleased(p: LockPublication, succeeds: bool): LockPublication = { ...p, step: GuardCleanup,
  tombstones: if (succeeds) p.tombstones.select(t => t != p.actor) else p.tombstones,
  primary: if (succeeds) NoLockError else ReleaseCleanupError }
pure def canFinishRelease(p: LockPublication): bool = p.step == Finish and p.op == Releasing
pure def finishRelease(p: LockPublication): LockPublication = { ...p, step: LockIdle,
  handles: if (p.primary == NoLockError) setHandle(p, p.actor, { ...handleOf(p, p.actor), complete: true }) else p.handles,
  diagnostic: if (p.guard == PubBlocked) ManualRecoveryNeeded else if (p.primary == NoLockError) ReleasedClean
    else if (handleOf(p, p.actor).released) ReleasedCleanupIncomplete else StillOwned }
```

### Manual recovery is external and only after every affected process stopped

A returned handle cannot be used after its process stopped, and recovery
never reuses the saved-path identity.

```quint
pure def needsRecovery(p: LockPublication): bool = p.guard == PubBlocked or p.diagnostic == CommittedWithoutHandle
pure def canConfirmAllStopped(p: LockPublication): bool = p.step == LockIdle and needsRecovery(p)
pure def confirmAllStopped(p: LockPublication): LockPublication = { ...p, allStopped: true }
pure def canManualRecovery(p: LockPublication): bool = p.step == LockIdle and p.allStopped and needsRecovery(p)
pure def manualRecovery(p: LockPublication): LockPublication = { ...p, guard: PubNone, canonical: 0, allStopped: false,
  diagnostic: ExternallyRecovered,
  handles: p.handles.listMap(h => if (h.published) { ...h, released: true, complete: true } else h) }
pure def alwaysRollbackUnpublished(p: LockPublication): bool =
  (p.step == Rollback implies p.guard == PubAcquire and not(handleOf(p, p.actor).published))
  and ((p.rolledBack and p.op == Acquiring) implies p.canonical != p.actor)
  and (p.staleDamaged implies p.canonical != priorOwner)
pure def alwaysHandles(p: LockPublication): bool = p.handles.every(h =>
  (h.released implies p.canonical != h.caller) and (h.complete implies h.released and h.published)
  and (h.released implies h.published))
  and (p.diagnostic == ReleasedClean implies not(p.tombstones.includes(p.actor)))
pure def alwaysDiagnostics(p: LockPublication): bool =
  (p.diagnostic == Acquired implies handleOf(p, p.actor).published)
  and (p.diagnostic == CommittedWithoutHandle implies p.canonical == p.actor and not(handleOf(p, p.actor).published))
  and (p.diagnostic == ManualRecoveryNeeded implies p.guard == PubBlocked)
pure def stepPublishedNeverReissued(before: LockPublication, after: LockPublication): bool =
  before.handles.every(h => h.published implies handleOf(after, h.caller).published)
pure def sometimesAcquired(p: LockPublication): bool = mayStart(p, 1) or mayStart(p, 2)
pure def sometimesRolledBack(p: LockPublication): bool = p.diagnostic == RolledBackAcquisition and p.staleDamaged
pure def sometimesCommittedWithoutHandle(p: LockPublication): bool = p.diagnostic == CommittedWithoutHandle
pure def sometimesBlockedUntilRecovery(p: LockPublication): bool = p.diagnostic == ManualRecoveryNeeded
pure def sometimesExternallyRecovered(p: LockPublication): bool = p.diagnostic == ExternallyRecovered
pure def sometimesReleasedClean(p: LockPublication): bool = p.diagnostic == ReleasedClean
pure def sometimesReleaseCleanupIncomplete(p: LockPublication): bool = p.diagnostic == ReleasedCleanupIncomplete
pure val callerValues = Set(1, 2)
pure val weight_prepare = 5
pure val weight_inspect = 5
pure val weight_publish = 5
pure val weight_cleanupGuard = 5
pure val weight_publishHandle = 5
```

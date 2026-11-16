# Contributor discovery lock and child ownership

PRD sections 4 and 12. Discovery runs for one GitHub identity share a local
lock (`skills/project-contributor-template/scripts/live-report.mjs`, legacy
`contributor_discovery_lock` with source tests
`scripts/contributor-discovery-lifetime.test.ts`). The lock has an owning
parent process, a helper that starts the read-only discovery command, and
the command's child process, which may outlive both. Every installed skill copy uses the same user-private lock for the
identity, so invocations from different copies contend for it; each owner
is a distinct owner token. Process liveness, directory renames and the
request file are shell evidence. The owner releases the lock only after the
[command completion](./commandCompletion.md) of its report has classified
the result.

The rule a contributor sees: if the command reports an active run, let it
finish before retrying. A persistent transition guard or an unpublished child
identity requires the operator to stop all affected local discovery
processes before manual recovery. Elapsed time alone never removes the lock.

## Story: Never reclaim a discovery lock while its command may still run

### Acquisition scans for a clear lock under a guard that excludes startup

A new owner enters an acquisition guard, observes that the previous owner's
process lease is inactive and that no command is active for its owner token,
and only then commits the acquisition. The scan and rename gap is explicit: a
helper cannot begin startup while the acquisition guard is held. Another
invocation that finds the guard held, a live owner or an active command
fails with a contention error and changes nothing.

```quint
import commandCompletion as CC from "./commandCompletion"
type Guard = NoGuard | AcquireGuard | StartupGuard | CrashedGuard
type HelperPhase = HelperNone | HelperWaiting | HelperChecking | HelperAdmitted | ChildUnpublished | ChildPublished
  | HelperRunning | HelperClosing | HelperClosed | HelperRefused | HelperDone | HelperCrashed
type Failure = NoLockFailure | BookkeepingFailure | CommandCleanupFailure | StaleCleanupFailure | AggregateCleanupFailure
type StaleCleanup = StaleRemoved | CleanupFails | CleanupAndRollbackFail
type DiscoveryLock = { owner: int, parentLive: bool, generation: int, guard: Guard, candidate: int, observedClear: bool,
  requestOwner: int, requestPresent: bool, helperLive: bool, phase: HelperPhase, commandLease: bool, childLive: bool,
  childPublished: bool, closeObserved: bool, launchOwner: int, primary: Failure, timeElapsed: bool,
  stalePending: bool, staleRemnants: int, takeovers: int, aggregate: bool, contentions: int, releaseFailures: int }
pure val initial: DiscoveryLock = { owner: 0, parentLive: false, generation: 0, guard: NoGuard, candidate: 0,
  observedClear: false, requestOwner: 0, requestPresent: false, helperLive: false, phase: HelperNone,
  commandLease: false, childLive: false, childPublished: false, closeObserved: false, launchOwner: 0,
  primary: NoLockFailure, timeElapsed: false, stalePending: false, staleRemnants: 0, takeovers: 0, aggregate: false,
  contentions: 0, releaseFailures: 0 }
pure def commandActive(s: DiscoveryLock): bool = s.commandLease and (s.helperLive or not(s.childPublished) or s.childLive)
pure def canEnterAcquire(s: DiscoveryLock, owner: int): bool = s.guard == NoGuard and owner > 0 and s.generation < 9007199254740000
  and not(s.aggregate)
pure def enterAcquire(s: DiscoveryLock, owner: int): DiscoveryLock = { ...s, guard: AcquireGuard, candidate: owner, observedClear: false }
pure def canObserveClear(s: DiscoveryLock): bool = s.guard == AcquireGuard and not(s.parentLive) and not(commandActive(s))
pure def observeClear(s: DiscoveryLock): DiscoveryLock = { ...s, observedClear: true }
pure def canCommitAcquire(s: DiscoveryLock): bool = s.guard == AcquireGuard and s.observedClear and not(s.stalePending)
  and s.takeovers < 9007199254740000
pure def commitAcquire(s: DiscoveryLock): DiscoveryLock = { ...s, owner: s.candidate, parentLive: true,
  generation: s.generation + 1, commandLease: false, childPublished: false, requestPresent: false, primary: NoLockFailure,
  phase: if (s.helperLive) s.phase else HelperNone, guard: if (s.owner == 0) NoGuard else AcquireGuard,
  stalePending: s.owner != 0, takeovers: if (s.owner == 0) s.takeovers else s.takeovers + 1 }
pure def canRefuseAcquire(s: DiscoveryLock): bool = s.guard == AcquireGuard and not(s.observedClear)
pure def refuseAcquire(s: DiscoveryLock): DiscoveryLock = { ...s, guard: NoGuard, contentions: s.contentions + 1 }
pure def canContend(s: DiscoveryLock, owner: int): bool = owner > 0 and owner != s.owner and owner != s.candidate
  and (s.guard != NoGuard or s.parentLive or commandActive(s)) and s.contentions < 9007199254740000
pure def contend(s: DiscoveryLock, owner: int): DiscoveryLock = { ...s, contentions: s.contentions + 1 }
pure def alwaysClearScanHolds(s: DiscoveryLock): bool = (s.observedClear and s.guard == AcquireGuard) implies not(commandActive(s))
pure def stepContentionChangesNothing(before: DiscoveryLock, via: str, after: DiscoveryLock): bool =
  (via == "contend" or via == "refuseAcquire") implies after.owner == before.owner and after.parentLive == before.parentLive
    and after.commandLease == before.commandLease and after.generation == before.generation
pure def stepTakeoverOnlyWhenStale(before: DiscoveryLock, after: DiscoveryLock): bool =
  (before.owner != 0 and after.owner != 0 and after.owner != before.owner) implies
    not(before.parentLive) and not(commandActive(before))
```

### A stale lock is renamed aside, and a failed cleanup rolls the new ownership back

Taking over a stale lock renames it to a unique stale path and claims the new
lock in one guarded step. The stale directory is then removed. If that
removal fails, the new, still unpublished ownership is revoked and the
partially removed stale directory is never restored as the lock. If the
revocation fails too, the invocation ends with an `AggregateError` naming
both failures while the new owner still holds the lock: nobody may retry as
if no lock was acquired, and only manual recovery after every affected
process stopped clears it.

```quint
pure def canFinishStaleCleanup(s: DiscoveryLock, cleanup: StaleCleanup): bool = s.guard == AcquireGuard and s.stalePending
  and s.staleRemnants < 9007199254740000
pure def finishStaleCleanup(s: DiscoveryLock, cleanup: StaleCleanup): DiscoveryLock =
  if (cleanup == StaleRemoved) { ...s, guard: NoGuard, stalePending: false }
  else if (cleanup == CleanupFails) { ...s, guard: NoGuard, stalePending: false, owner: 0, parentLive: false,
    staleRemnants: s.staleRemnants + 1, primary: StaleCleanupFailure }
  else { ...s, guard: NoGuard, stalePending: false, staleRemnants: s.staleRemnants + 1, aggregate: true,
    primary: AggregateCleanupFailure }
pure def alwaysStaleCleanupGuarded(s: DiscoveryLock): bool = (s.stalePending implies s.guard == AcquireGuard and s.owner != 0
  and s.owner == s.candidate and not(commandActive(s)))
  and (s.aggregate implies s.owner != 0 and s.primary == AggregateCleanupFailure)
  and s.staleRemnants >= 0 and s.contentions >= 0 and s.takeovers >= 0 and s.releaseFailures >= 0
pure def sometimesStaleTakeover(s: DiscoveryLock): bool = s.takeovers > 0 and s.guard == NoGuard and s.parentLive
  and s.primary == NoLockFailure
pure def sometimesRolledBack(s: DiscoveryLock): bool = s.primary == StaleCleanupFailure and s.owner == 0 and s.staleRemnants > 0
pure def sometimesAggregate(s: DiscoveryLock): bool = s.aggregate and s.owner != 0
pure def sometimesContended(s: DiscoveryLock): bool = s.contentions > 0 and s.parentLive
```

### Only the current owner's live handle starts a helper, and startup checks the owner again

A released or stale handle cannot publish a request into a successor's lock.
A helper may have read its request before a dead owner's lock was replaced;
its startup check then refuses, and so does every startup while an
aggregate cleanup failure holds the lock. Startup holds its own guard until the child's
identity is published, or until a failed spawn is observed closed.

```quint
pure def idleHelper(s: DiscoveryLock): bool = s.phase == HelperNone or s.phase == HelperDone or s.phase == HelperRefused
pure def canRequest(s: DiscoveryLock, owner: int): bool = s.guard == NoGuard and s.owner == owner and owner > 0
  and s.parentLive and idleHelper(s) and not(commandActive(s)) and not(s.aggregate)
pure def request(s: DiscoveryLock, owner: int): DiscoveryLock = { ...s, requestOwner: owner, requestPresent: true,
  helperLive: true, phase: HelperWaiting, primary: NoLockFailure }
pure def canBeginStartup(s: DiscoveryLock): bool = s.guard == NoGuard and s.helperLive and s.phase == HelperWaiting
pure def beginStartup(s: DiscoveryLock): DiscoveryLock = { ...s, guard: StartupGuard, phase: HelperChecking }
pure def canAdmitStartup(s: DiscoveryLock): bool = s.guard == StartupGuard and s.phase == HelperChecking
  and s.requestOwner == s.owner and s.owner != 0 and not(s.aggregate)
pure def admitStartup(s: DiscoveryLock): DiscoveryLock = { ...s, commandLease: true, childPublished: false,
  closeObserved: false, phase: HelperAdmitted }
pure def canRefuseStartup(s: DiscoveryLock): bool = s.guard == StartupGuard and s.phase == HelperChecking
  and (s.requestOwner != s.owner or s.owner == 0 or s.aggregate)
pure def refuseStartup(s: DiscoveryLock): DiscoveryLock = { ...s, guard: NoGuard, helperLive: false, phase: HelperRefused }
pure def canSpawnChild(s: DiscoveryLock): bool = s.guard == StartupGuard and s.phase == HelperAdmitted and s.helperLive
pure def spawnChild(s: DiscoveryLock): DiscoveryLock = { ...s, childLive: true, launchOwner: s.owner, phase: ChildUnpublished }
pure def canPublishChild(s: DiscoveryLock): bool = s.guard == StartupGuard and s.phase == ChildUnpublished and s.helperLive and s.childLive
pure def publishChild(s: DiscoveryLock): DiscoveryLock = { ...s, childPublished: true, phase: ChildPublished }
pure def canFailBookkeeping(s: DiscoveryLock): bool = s.guard == StartupGuard
  and (s.phase == HelperAdmitted or s.phase == ChildUnpublished or s.phase == HelperClosed)
pure def failBookkeeping(s: DiscoveryLock): DiscoveryLock = { ...s, phase: HelperClosing, primary: BookkeepingFailure }
pure def canObserveFailedSpawnClosed(s: DiscoveryLock): bool = s.guard == StartupGuard and s.phase == HelperClosing and not(s.childLive)
pure def observeFailedSpawnClosed(s: DiscoveryLock): DiscoveryLock = { ...s, closeObserved: true }
pure def canReleaseStartup(s: DiscoveryLock): bool = s.guard == StartupGuard and s.helperLive
  and (s.childPublished or (not(s.childLive) and s.closeObserved))
  and (s.phase == ChildPublished or s.phase == HelperClosed or s.phase == HelperClosing)
pure def releaseStartup(s: DiscoveryLock): DiscoveryLock = { ...s, guard: NoGuard, phase: if (s.childLive) HelperRunning else HelperClosed }
pure def alwaysAdmittedLease(s: DiscoveryLock): bool = (s.phase == HelperAdmitted implies
  s.guard == StartupGuard and s.commandLease and s.owner != 0 and not(s.closeObserved) and not(s.childLive))
  and ((s.phase == HelperWaiting or s.phase == HelperChecking) implies not(s.childLive))
pure def alwaysChildOwned(s: DiscoveryLock): bool = s.childLive implies s.owner != 0 and s.owner == s.launchOwner and s.commandLease
pure def alwaysCloseObserved(s: DiscoveryLock): bool = s.closeObserved implies not(s.childLive)
pure def alwaysStartupHasHelper(s: DiscoveryLock): bool = (s.guard == StartupGuard implies s.helperLive)
  and (s.phase == ChildUnpublished implies s.guard == StartupGuard)
```

### Process deaths keep the lock until the command is provably gone

A child can stop by itself. A helper that dies during startup leaves a
crashed guard; a dead helper with a command lease leaves a crashed phase. A
parent can die at any time. Command cleanup releases the lease only after the
child stopped, and a failed cleanup keeps it and never replaces an earlier
failure. The owner releases only a lock with no active command. A lease
written by an older client version has unknown child state and stays
active. Time passing changes none of these facts.

```quint
pure def canChildStops(s: DiscoveryLock): bool = s.childLive
pure def childStops(s: DiscoveryLock): DiscoveryLock = { ...s, childLive: false, closeObserved: true,
  phase: if (s.guard == CrashedGuard) HelperCrashed else HelperClosed }
pure def canHelperDies(s: DiscoveryLock): bool = s.helperLive
pure def helperDies(s: DiscoveryLock): DiscoveryLock = { ...s, helperLive: false,
  guard: if (s.guard == StartupGuard) CrashedGuard else s.guard,
  phase: if (s.guard == StartupGuard or s.commandLease) HelperCrashed else HelperDone }
pure def canParentDies(s: DiscoveryLock): bool = s.parentLive
pure def parentDies(s: DiscoveryLock): DiscoveryLock = { ...s, parentLive: false }
pure def canCleanupCommand(s: DiscoveryLock): bool = s.guard == NoGuard and s.helperLive and s.commandLease and not(s.childLive)
pure def cleanupCommand(s: DiscoveryLock, fails: bool): DiscoveryLock = { ...s, helperLive: false, commandLease: fails,
  phase: HelperDone, requestPresent: false,
  primary: if (fails and s.primary == NoLockFailure) CommandCleanupFailure else s.primary }
pure def canRelease(s: DiscoveryLock, owner: int, report: CC::Completion, fails: bool): bool = s.guard == NoGuard
  and s.owner == owner and owner > 0 and s.parentLive and not(commandActive(s)) and not(s.aggregate)
  and CC::canRelease(report) and CC::alwaysCleanupOrder(report) and CC::alwaysPublished(report)
  and s.releaseFailures < 9007199254740000
pure def release(s: DiscoveryLock, owner: int, report: CC::Completion, fails: bool): DiscoveryLock =
  if (fails) { ...s, releaseFailures: s.releaseFailures + 1 } else { ...s, owner: 0, parentLive: false, requestPresent: false }
pure def sometimesFailedReleaseTakenOver(s: DiscoveryLock): bool = s.releaseFailures > 0 and s.takeovers > 0 and s.parentLive
pure def canObserveLegacyLease(s: DiscoveryLock, live: bool): bool = s.guard == NoGuard and s.owner != 0
  and s.phase == HelperNone and not(s.commandLease) and not(s.helperLive)
pure def observeLegacyLease(s: DiscoveryLock, live: bool): DiscoveryLock = { ...s, parentLive: false, commandLease: true,
  childPublished: false, childLive: live, closeObserved: false, launchOwner: s.owner, phase: HelperCrashed }
pure def timePasses(s: DiscoveryLock): DiscoveryLock = { ...s, timeElapsed: true }
pure def stepTimeReleasesNothing(before: DiscoveryLock, via: str, after: DiscoveryLock): bool = via == "timePasses" implies
  after.guard == before.guard and after.commandLease == before.commandLease and after.owner == before.owner
```

### Manual recovery requires every affected process positively stopped

Manual recovery is an operator action outside the application. It applies
only to a crashed guard, an unpublished-child lease or an aggregate cleanup
failure, and only when parent, helper and child are all stopped.

```quint
pure def canManualRecovery(s: DiscoveryLock): bool = not(s.parentLive) and not(s.helperLive) and not(s.childLive)
  and (s.guard == CrashedGuard or (s.guard == NoGuard and s.commandLease and not(s.childPublished))
    or (s.guard == NoGuard and s.aggregate))
pure def manualRecovery(s: DiscoveryLock): DiscoveryLock = { ...s, guard: NoGuard, commandLease: false, requestPresent: false,
  phase: HelperDone, aggregate: false }
pure def lawLiveChildBlocksRecovery(s: DiscoveryLock): bool = s.childLive implies not(canManualRecovery(s))
pure def sometimesReclaimedFromStaleOwner(s: DiscoveryLock): bool = s.generation >= 2 and s.parentLive
pure def sometimesChildOutlivesHelper(s: DiscoveryLock): bool = s.childLive and s.childPublished and not(s.helperLive) and not(s.parentLive)
pure def sometimesCrashedGuardHeldAfterTime(s: DiscoveryLock): bool = s.guard == CrashedGuard and s.timeElapsed
pure def sometimesLegacyLeaseHeldAfterTime(s: DiscoveryLock): bool = s.commandLease and s.phase == HelperCrashed and s.timeElapsed and not(s.childPublished)
pure def sometimesRecovered(s: DiscoveryLock): bool = s.phase == HelperDone and s.generation >= 1 and not(s.commandLease) and not(s.parentLive) and s.timeElapsed
pure def sometimesBookkeepingFailureKept(s: DiscoveryLock): bool = s.primary == BookkeepingFailure and s.phase == HelperDone
pure val ownerValues = Set(1, 2)
pure val sValues = Set(initial, { ...initial, owner: 1, commandLease: true, childLive: true, launchOwner: 1, childPublished: true },
  { ...initial, owner: 1, guard: CrashedGuard })
pure val cleanupValues = Set(StaleRemoved, CleanupFails, CleanupAndRollbackFail)
pure val releasingReport: CC::Completion = { ...CC::initial, phase: CC::Releasing, command: CC::SuccessfulCommand,
  reportPublished: true }
pure val reportValues = Set(releasingReport, { ...releasingReport, command: CC::NonzeroCommand, primary: CC::CommandFailure,
  outputRetained: true, reportPublished: false }, CC::initial)
pure val weight_finishStaleCleanup = 6
pure val weight_contend = 2
pure val weight_enterAcquire = 6
pure val weight_observeClear = 6
pure val weight_commitAcquire = 6
pure val weight_request = 6
pure val weight_beginStartup = 6
pure val weight_admitStartup = 6
pure val weight_spawnChild = 6
pure val weight_publishChild = 6
pure val weight_releaseStartup = 6
```

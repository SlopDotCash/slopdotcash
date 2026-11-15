# Publication lock per environment

CLAUDE.md "Deployment" requires every production release to use the shared
publication lock, and `backend/trace/PRIVATE_INTAKE_RECOVERY.md` requires an
obsolete data refresh to be rejected if production advances before it
obtains that lock. The pinned implementation is the GitHub Actions
concurrency group of `.github/workflows/deploy.yml`: `slop-production` for
`main` and `slop-staging` for `development`, each without cancelling a
waiting run. Staging and production are separate stacks, so each has its own
lock.

This machine is the lock shared by every [release run](./release.md) and data
refresh of an environment. A release run's `acquireLock` is this machine's
`acquire` of the same run. The hourly health jobs and the private-intake
watch run outside this lock. The `by` sender is the authenticated run
identity GitHub supplies.

## Story: Publish one run at a time per environment from the current branch head

### At most one run of an environment holds the lock, and health jobs never take it

A code release or data refresh records the branch head it was started from.
A waiting run takes the lock only when no run of its environment holds it.
A data refresh whose branch advanced before it obtained the lock is rejected
without publishing. A holder whose branch advanced by the time it would
publish is superseded and releases the lock; the newer run publishes.

```quint
type Environment = Production | Staging
type RunKind = CodeRelease | DataRefresh
type RunPhase = Waiting | Holding | Published | Superseded | Rejected
type Actor = TrustedWorkflow | HealthJob | Contributor
type Run = { id: int, environment: Environment, kind: RunKind, source: int, phase: RunPhase }
type Locks = { runs: List[Run], production: int, staging: int, mainHead: int, developmentHead: int, healthRuns: int }
pure val initial: Locks = { runs: List(), production: 0, staging: 0, mainHead: 1, developmentHead: 1, healthRuns: 0 }
pure val noRun: Run = { id: 0, environment: Production, kind: CodeRelease, source: 0, phase: Rejected }
pure def branchHead(l: Locks, environment: Environment): int = if (environment == Production) l.mainHead else l.developmentHead
pure def holder(l: Locks, environment: Environment): int = if (environment == Production) l.production else l.staging
pure def runOf(l: Locks, id: int): Run = l.runs.nthOr(id - 1, noRun)
pure def setPhase(l: Locks, id: int, phase: RunPhase): List[Run] = l.runs.listMap(r => if (r.id == id) { ...r, phase: phase } else r)
pure def withHolder(environment: Environment, id: int, l: Locks): Locks =
  if (environment == Production) { ...l, production: id } else { ...l, staging: id }
pure def canStart(l: Locks, environment: Environment, kind: RunKind, by: Actor): bool = by == TrustedWorkflow
pure def start(l: Locks, environment: Environment, kind: RunKind, by: Actor): Locks =
  { ...l, runs: l.runs.append({ id: l.runs.length() + 1, environment: environment, kind: kind, source: branchHead(l, environment), phase: Waiting }) }
pure def canAdvanceBranch(l: Locks, environment: Environment): bool = true
pure def advanceBranch(l: Locks, environment: Environment): Locks =
  if (environment == Production) { ...l, mainHead: l.mainHead + 1 } else { ...l, developmentHead: l.developmentHead + 1 }
pure def canAcquire(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and r.phase == Waiting and holder(l, r.environment) == 0
    and (r.kind == DataRefresh implies r.source == branchHead(l, r.environment))
pure def acquire(l: Locks, id: int): Locks = val r = runOf(l, id)
  { ...withHolder(r.environment, id, l), runs: setPhase(l, id, Holding) }
pure def canRejectObsolete(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and r.phase == Waiting and r.kind == DataRefresh and r.source != branchHead(l, r.environment)
pure def rejectObsolete(l: Locks, id: int): Locks = { ...l, runs: setPhase(l, id, Rejected) }
pure def canFinish(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and r.phase == Holding and holder(l, r.environment) == id
pure def finish(l: Locks, id: int): Locks = val r = runOf(l, id)
  { ...withHolder(r.environment, 0, l), runs: setPhase(l, id, if (r.source == branchHead(l, r.environment)) Published else Superseded) }
pure def canRunHealthJob(l: Locks, by: Actor): bool = by == HealthJob
pure def runHealthJob(l: Locks, by: Actor): Locks = { ...l, healthRuns: l.healthRuns + 1 }
pure def alwaysOneHolderPerEnvironment(l: Locks): bool =
  l.runs.every(r => r.phase == Holding implies holder(l, r.environment) == r.id)
    and (l.production > 0 implies runOf(l, l.production).phase == Holding and runOf(l, l.production).environment == Production)
    and (l.staging > 0 implies runOf(l, l.staging).phase == Holding and runOf(l, l.staging).environment == Staging)
pure def alwaysRunsWellFormed(l: Locks): bool = l.mainHead > 0 and l.developmentHead > 0 and l.runs.every(r => r.id > 0 and runOf(l, r.id) == r
  and r.source > 0 and r.source <= branchHead(l, r.environment))
pure def stepHealthJobNeverLocks(before: Locks, via: str, after: Locks): bool =
  via == "runHealthJob" implies after.production == before.production and after.staging == before.staging and after.runs == before.runs
pure def stepPublishesOnlyCurrentSource(before: Locks, after: Locks): bool =
  after.runs.every(a => (a.phase == Published and not(before.runs.some(b => b.id == a.id and b.phase == Published)))
    implies a.source == branchHead(after, a.environment))
pure def stepOutcomesFinal(before: Locks, after: Locks): bool = before.runs.every(b =>
  (b.phase == Published or b.phase == Superseded or b.phase == Rejected) implies after.runs.includes(b))
pure def sometimesBothEnvironmentsHold(l: Locks): bool = l.production > 0 and l.staging > 0
pure def sometimesWaitingBehindHolder(l: Locks): bool = l.production > 0 and l.runs.some(r => r.environment == Production and r.phase == Waiting)
pure def sometimesObsoleteRefreshRejected(l: Locks): bool = l.runs.some(r => r.phase == Rejected)
pure def sometimesSupersededHolder(l: Locks): bool = l.runs.some(r => r.phase == Superseded)
pure def sometimesPublished(l: Locks): bool = l.runs.some(r => r.phase == Published)
pure val idValues = Set(1, 2, 3)
pure val byValues = Set(TrustedWorkflow, HealthJob)
pure val weight_acquire = 5
pure val weight_finish = 5
```

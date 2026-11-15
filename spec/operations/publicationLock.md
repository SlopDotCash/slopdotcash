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
publish is superseded and releases the lock; the newer run publishes. Each
branch keeps its fast-forward lineage: a push that is not a fast-forward
starts a new lineage, and a run whose source is no longer in its branch's
lineage is refused whether it waits or holds. A holder that fails releases
the lock without publishing, and a holder that proves its publication never
happened yields the lock and waits again.

```quint
type Environment = Production | Staging
type RunKind = CodeRelease | DataRefresh
type RunPhase = Waiting | Holding | Published | Superseded | Rejected | Abandoned
type Actor = TrustedWorkflow | HealthJob | Contributor
type Run = { id: int, environment: Environment, kind: RunKind, source: int, phase: RunPhase }
type Locks = { runs: List[Run], production: int, staging: int, mainHead: int, developmentHead: int, healthRuns: int,
  mainLineage: List[int], developmentLineage: List[int], nextHead: int }
pure val initial: Locks = { runs: List(), production: 0, staging: 0, mainHead: 1, developmentHead: 1, healthRuns: 0,
  mainLineage: List(1), developmentLineage: List(1), nextHead: 2 }
pure val noRun: Run = { id: 0, environment: Production, kind: CodeRelease, source: 0, phase: Rejected }
pure def branchHead(l: Locks, environment: Environment): int = if (environment == Production) l.mainHead else l.developmentHead
pure def holder(l: Locks, environment: Environment): int = if (environment == Production) l.production else l.staging
pure def runOf(l: Locks, id: int): Run = l.runs.nthOr(id - 1, noRun)
pure def withPhase(r: Run, phase: RunPhase): Run = { ...r, phase: phase }
pure def setPhase(l: Locks, id: int, phase: RunPhase): List[Run] = l.runs.listMap(r => if (r.id == id) withPhase(r, phase) else r)
pure def withHolder(environment: Environment, id: int, l: Locks): Locks =
  if (environment == Production) { ...l, production: id } else { ...l, staging: id }
pure def canStart(l: Locks, environment: Environment, kind: RunKind, by: Actor): bool = by == TrustedWorkflow
pure def start(l: Locks, environment: Environment, kind: RunKind, by: Actor): Locks =
  { ...l, runs: l.runs.append({ id: l.runs.length() + 1, environment: environment, kind: kind, source: branchHead(l, environment), phase: Waiting }) }
pure def lineage(l: Locks, environment: Environment): List[int] =
  if (environment == Production) l.mainLineage else l.developmentLineage
pure def fastForwardOf(l: Locks, environment: Environment, source: int): bool = lineage(l, environment).includes(source)
pure def canAdvanceBranch(l: Locks, environment: Environment): bool = true
pure def advanceBranch(l: Locks, environment: Environment): Locks =
  if (environment == Production) { ...l, mainHead: l.nextHead, mainLineage: l.mainLineage.append(l.nextHead), nextHead: l.nextHead + 1 }
  else { ...l, developmentHead: l.nextHead, developmentLineage: l.developmentLineage.append(l.nextHead), nextHead: l.nextHead + 1 }
pure def canRewriteBranch(l: Locks, environment: Environment): bool = true
pure def rewriteBranch(l: Locks, environment: Environment): Locks =
  if (environment == Production) { ...l, mainHead: l.nextHead, mainLineage: List(l.nextHead), nextHead: l.nextHead + 1 }
  else { ...l, developmentHead: l.nextHead, developmentLineage: List(l.nextHead), nextHead: l.nextHead + 1 }
pure def canAcquire(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and r.phase == Waiting and holder(l, r.environment) == 0
    and (r.kind == DataRefresh implies r.source == branchHead(l, r.environment))
pure def acquire(l: Locks, id: int): Locks =
  { ...withHolder(runOf(l, id).environment, id, l), runs: setPhase(l, id, Holding) }
pure def canRejectObsolete(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and r.phase == Waiting and r.kind == DataRefresh and r.source != branchHead(l, r.environment)
pure def rejectObsolete(l: Locks, id: int): Locks = { ...l, runs: setPhase(l, id, Rejected) }
pure def canFinish(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and r.phase == Holding and holder(l, r.environment) == id
pure def finish(l: Locks, id: int): Locks =
  { ...withHolder(runOf(l, id).environment, 0, l),
    runs: setPhase(l, id, if (runOf(l, id).source == branchHead(l, runOf(l, id).environment)) Published else Superseded) }
pure def canAbandon(l: Locks, id: int): bool = canFinish(l, id)
pure def abandon(l: Locks, id: int): Locks =
  { ...withHolder(runOf(l, id).environment, 0, l), runs: setPhase(l, id, Abandoned) }
pure def canYieldLock(l: Locks, id: int): bool = canFinish(l, id)
pure def yieldLock(l: Locks, id: int): Locks =
  { ...withHolder(runOf(l, id).environment, 0, l), runs: setPhase(l, id, Waiting) }
pure def canRefuseRewritten(l: Locks, id: int): bool = val r = runOf(l, id)
  r.id == id and (r.phase == Waiting or (r.phase == Holding and holder(l, r.environment) == id))
    and not(fastForwardOf(l, r.environment, r.source))
pure def refuseRewritten(l: Locks, id: int): Locks =
  { ...(if (runOf(l, id).phase == Holding) withHolder(runOf(l, id).environment, 0, l) else l), runs: setPhase(l, id, Rejected) }
pure def canRunHealthJob(l: Locks, by: Actor): bool = by == HealthJob
pure def runHealthJob(l: Locks, by: Actor): Locks = { ...l, healthRuns: l.healthRuns + 1 }
pure def alwaysOneHolderPerEnvironment(l: Locks): bool =
  l.runs.every(r => r.phase == Holding implies holder(l, r.environment) == r.id)
    and (l.production > 0 implies runOf(l, l.production).phase == Holding and runOf(l, l.production).environment == Production)
    and (l.staging > 0 implies runOf(l, l.staging).phase == Holding and runOf(l, l.staging).environment == Staging)
pure def alwaysRunsWellFormed(l: Locks): bool = l.mainHead > 0 and l.developmentHead > 0 and l.runs.every(r => r.id > 0 and runOf(l, r.id) == r
  and r.source > 0 and r.source <= branchHead(l, r.environment))
pure def alwaysHeadsEndLineage(l: Locks): bool = l.mainLineage.length() > 0 and l.developmentLineage.length() > 0
  and l.mainLineage.nthOr(l.mainLineage.length() - 1, 0) == l.mainHead
  and l.developmentLineage.nthOr(l.developmentLineage.length() - 1, 0) == l.developmentHead
  and l.mainHead < l.nextHead and l.developmentHead < l.nextHead
pure def stepHealthJobNeverLocks(before: Locks, via: str, after: Locks): bool =
  via == "runHealthJob" implies after.production == before.production and after.staging == before.staging and after.runs == before.runs
pure def stepPublishesOnlyCurrentSource(before: Locks, after: Locks): bool =
  after.runs.every(a => (a.phase == Published and not(before.runs.some(b => b.id == a.id and b.phase == Published)))
    implies a.source == branchHead(after, a.environment))
pure def stepOutcomesFinal(before: Locks, after: Locks): bool = before.runs.every(b =>
  (b.phase == Published or b.phase == Superseded or b.phase == Rejected or b.phase == Abandoned) implies after.runs.includes(b))
pure def sometimesBothEnvironmentsHold(l: Locks): bool = l.production > 0 and l.staging > 0
pure def sometimesWaitingBehindHolder(l: Locks): bool = l.production > 0 and l.runs.some(r => r.environment == Production and r.phase == Waiting)
pure def sometimesObsoleteRefreshRejected(l: Locks): bool = l.runs.some(r => r.phase == Rejected)
pure def sometimesSupersededHolder(l: Locks): bool = l.runs.some(r => r.phase == Superseded)
pure def sometimesPublished(l: Locks): bool = l.runs.some(r => r.phase == Published)
pure def sometimesRewrittenRefused(l: Locks): bool = l.runs.some(r => r.phase == Rejected and r.kind == CodeRelease)
pure def sometimesAbandoned(l: Locks): bool = l.runs.some(r => r.phase == Abandoned)
pure val idValues = Set(1, 2, 3)
pure val byValues = Set(TrustedWorkflow, HealthJob)
pure val weight_acquire = 5
pure val weight_finish = 5
```

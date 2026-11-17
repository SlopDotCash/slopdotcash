# Scheduled payments runs

PRD sections 6, 11 and 12. The pinned source is `workers/payments/index.ts`
(`scheduled` and `runMonthlyCommitments`). [Independent payment job
runs](./paymentJobs.md) owns each network's admission and outcome inside a
step; this machine owns the order of the steps of one scheduled run of the
payments Worker, what a failing step does to the others, and which monthly
commitments one run sends. Mainnet monthly commitments go through the
operator keeper; this bound applies to the staging and test stacks that
still commit through the payments Worker. A security-bounty payments Worker
sends no monthly commitment, and neither does one without a valid monthly
schedule.

## Story: Run every payments step on each schedule and report what failed

### Each step of a payments run fails alone and the run reports every failure at its end

A run takes its steps in a fixed order: synchronize the registry vaults,
recover uncertain attempts, reconcile failed attempts, run the monthly
coordinator, send the monthly commitments, and dispatch payments. A step
that fails, a single network or candidate within it included, records its
failure and the run goes on to the next step; no failure skips a later step.
After the last step the run reports every recorded failure together, and a
run with none reports success. Two failures come before any step can isolate
them, as in the old `scheduled`, which reads the registry outside its
per-step handling: when the registry read or the payment network
configuration fails at the start of the vault synchronization, the run ends
at once and reports that one failure, and no later step runs. The owner may
instead make that read fail alone like the other steps; that would be new
behaviour, and the decision is pending.

A new run starts only after the previous one reported and keeps no failure
of it. This serialization is new: the old payments Worker took no lease, so
an overlapping cron invocation ran beside the one in progress. Here the shell
holds a run lease, and an invocation that arrives while a run is going is
refused and counted, as [Independent payment job runs](./paymentJobs.md)
does for its jobs. The owner's decision is pending; the alternative is to
allow overlapping runs as before.

```quint
type RunStep = SyncVaults | RecoverUncertain | ReconcileFailed | Coordinate | CommitMonthly | Dispatch
type StepOutcome = StepSucceeded | StepFailed
type CommitResult = CommitCompleted | CommitSubmitted | CommitSkipped | CommitFailed
type RunPhase = Idle | Running | Reported
type Candidate = { project: int, period: int, lastAttempt: int, resumable: bool, chained: bool }
type CommitKey = { project: int, period: int }
type PaymentRun = { phase: RunPhase, runs: int, position: int, failures: List[RunStep], reportedFailures: int,
  pending: List[Candidate], selected: bool, chosen: List[Candidate], roots: List[Candidate], committed: List[CommitKey],
  lastResult: CommitResult, overlapsRefused: int }
pure val runOrder: List[RunStep] = List(SyncVaults, RecoverUncertain, ReconcileFailed, Coordinate, CommitMonthly, Dispatch)
pure val stepCount = 6
pure val initial: PaymentRun = { phase: Idle, runs: 0, position: 0, failures: List(), reportedFailures: 0,
  pending: List(), selected: false, chosen: List(), roots: List(), committed: List(), lastResult: CommitSkipped,
  overlapsRefused: 0 }
pure def currentStep(r: PaymentRun): RunStep = runOrder.nthOr(r.position, Dispatch)
pure def canBegin(r: PaymentRun): bool = r.phase != Running
pure def begin(r: PaymentRun): PaymentRun = { ...r, phase: Running, runs: r.runs + 1, position: 0, failures: List(),
  reportedFailures: 0, selected: false, chosen: List(), roots: List(), committed: List(), lastResult: CommitSkipped }
pure def canRefuseOverlap(r: PaymentRun): bool = r.phase == Running
pure def refuseOverlap(r: PaymentRun): PaymentRun = { ...r, overlapsRefused: r.overlapsRefused + 1 }
pure def canAbortRun(r: PaymentRun): bool = r.phase == Running and r.position == 0
pure def abortRun(r: PaymentRun): PaymentRun =
  { ...r, phase: Reported, failures: r.failures.append(SyncVaults), reportedFailures: r.failures.length() + 1 }
pure def canSettleStep(r: PaymentRun, stepOutcome: StepOutcome): bool = r.phase == Running and r.position < stepCount
  and (currentStep(r) != CommitMonthly or (stepOutcome == StepFailed and not(r.selected)))
pure def settleStep(r: PaymentRun, stepOutcome: StepOutcome): PaymentRun = { ...r, position: r.position + 1,
  failures: if (stepOutcome == StepFailed) r.failures.append(currentStep(r)) else r.failures }
pure def canReport(r: PaymentRun): bool = r.phase == Running and r.position == stepCount
pure def report(r: PaymentRun): PaymentRun = { ...r, phase: Reported, reportedFailures: r.failures.length() }
pure def alwaysRunWithinItsSteps(r: PaymentRun): bool = r.position >= 0 and r.position <= stepCount
  and (r.phase == Idle implies r.position == 0 and r.failures.length() == 0 and r.runs == 0)
  and (r.phase == Reported implies (r.position == stepCount or (r.position == 0 and r.failures.includes(SyncVaults)))
    and r.reportedFailures == r.failures.length())
pure def stepFailureNeverSkipsALaterStep(before: PaymentRun, via: str, after: PaymentRun): bool =
  (via == "settleStep" or via == "finishCommitments") implies after.position == before.position + 1
pure def stepFailuresKeptUntilTheNextRun(before: PaymentRun, via: str, after: PaymentRun): bool =
  via != "begin" implies (after.failures.length() >= before.failures.length()
    and before.failures.every(f => after.failures.includes(f)))
pure def sometimesLaterStepsRanAfterAFailure(r: PaymentRun): bool =
  r.phase == Reported and r.position == stepCount and r.failures.includes(SyncVaults) and not(r.failures.includes(Dispatch))
pure def sometimesCleanRun(r: PaymentRun): bool = r.phase == Reported and r.failures.length() == 0 and r.runs > 0
pure def sometimesRunEndedByRegistryRead(r: PaymentRun): bool =
  r.phase == Reported and r.position == 0 and r.failures.includes(SyncVaults)
pure def sometimesOverlapRefused(r: PaymentRun): bool = r.overlapsRefused > 0 and r.phase == Reported
pure val weight_settleStep = 10
pure val weight_report = 5
pure val weight_abortRun = 1
pure val weight_refuseOverlap = 2
```

### A run admits at most 50 monthly commitment candidates and 50 prerequisite roots in fair retry order

The candidates are the served networks' incomplete monthly authorizations
for the active period, and those of any period that a Solana month or an
EVM month with the version 2 reserve can still resume. One project, period
and network is one candidate; `project` here stands for the project,
network and vault. The run chooses the 50 that were attempted least
recently, then by period, then by project. For every chosen EVM version 2
month older than the active period it adds the active period's version 2
root of the same project, network and vault when that root is still
pending, at most one per chosen month. It sends the newest period first, so
an admitting reservation is sent before any older month's leaf could
advance the source sequence and revert it. Each send first stamps the
candidate's attempt time, so a candidate that keeps failing moves behind
the others. A month is sent with admission only for a project with
automatic payment on, between its period's cutoff and the next period's
cutoff; an older or opted-out month is sent without admission and only when
it can resume. Each send ends one of four ways. It completes when the
executor reports the month complete (a version 2 month whose leaves are all
on chain, or a legacy month already committed whose journaled transaction is
mined), and only then does the candidate leave the pending set. It is
submitted when the executor returned a transaction but the month is not yet
complete, such as a legacy month whose re-sent nonce is unmined or a version
2 month with leaves still pending; the candidate stays pending. It is
skipped, with no send and no failure, when the month neither admits nor can
resume, or when a resumable month sent without admission is answered not
admitted; it stays pending. It fails otherwise, which records a failure
while the others are still sent. Selection never chooses more than 50,
because a candidate is chosen only when fewer than 50 precede it; its guard
states the bound as well.

```quint
pure val commitmentLimit = 50
pure def keyOf(c: Candidate): CommitKey = { project: c.project, period: c.period }
pure val noCandidate: Candidate = { project: 0, period: 0, lastAttempt: 0, resumable: false, chained: false }
pure def eligible(c: Candidate, active: int): bool = c.period == active or c.resumable
pure def fairlyBefore(a: Candidate, b: Candidate): bool = a.lastAttempt < b.lastAttempt
  or (a.lastAttempt == b.lastAttempt and (a.period < b.period or (a.period == b.period and a.project < b.project)))
pure def choose(pending: List[Candidate], active: int): List[Candidate] =
  val openCandidates = pending.select(c => eligible(c, active))
  openCandidates.select(c => openCandidates.select(d => fairlyBefore(d, c)).length() < commitmentLimit)
pure def rootFor(pending: List[Candidate], chosen: List[Candidate], s: Candidate, active: int): Candidate =
  if (s.chained and s.period < active)
    pending.foldl(noCandidate, (found, p) => if (found.project == 0 and p.project == s.project and p.period == active
      and p.chained and not(chosen.includes(p))) p else found)
  else noCandidate
pure def rootsFor(pending: List[Candidate], chosen: List[Candidate], active: int): List[Candidate] =
  chosen.listMap(s => rootFor(pending, chosen, s, active))
pure def batch(r: PaymentRun): List[Candidate] = r.chosen.concat(r.roots).select(c => c.project > 0)
pure def inCutoffWindow(now: int, cutoff: int, closes: int): bool = cutoff > 0 and closes > 0 and now >= cutoff and now < closes
pure def admitsMonth(automatic: bool, inWindow: bool): bool = automatic and inWindow
pure def sendsMonth(admit: bool, resumable: bool): bool = admit or resumable
pure def sendable(r: PaymentRun, project: int, period: int, admit: bool): bool =
  batch(r).some(c => c.project == project and c.period == period and sendsMonth(admit, c.resumable))
pure def canAddCandidate(r: PaymentRun, project: int, period: int, resumable: bool, chained: bool): bool =
  project > 0 and period > 0 and (chained implies resumable)
    and not(r.pending.some(c => c.project == project and c.period == period))
pure def addCandidate(r: PaymentRun, project: int, period: int, resumable: bool, chained: bool): PaymentRun =
  { ...r, pending: r.pending.append({ project: project, period: period, lastAttempt: 0, resumable: resumable, chained: chained }) }
pure def canSelectCommitments(r: PaymentRun, active: int): bool =
  r.phase == Running and r.position < stepCount and currentStep(r) == CommitMonthly and not(r.selected) and active > 0
    and choose(r.pending, active).length() <= commitmentLimit
pure def selectCommitments(r: PaymentRun, active: int): PaymentRun =
  val chosen = choose(r.pending, active)
  { ...r, selected: true, chosen: chosen, roots: rootsFor(r.pending, chosen, active) }
pure def committedKey(r: PaymentRun, project: int, period: int): bool =
  r.committed.includes({ project: project, period: period })
pure def canCommit(r: PaymentRun, project: int, period: int, result: CommitResult, automatic: bool, inWindow: bool): bool =
  val admit = admitsMonth(automatic, inWindow)
  r.phase == Running and r.selected and currentStep(r) == CommitMonthly and project > 0
    and batch(r).some(c => c.project == project and c.period == period) and not(committedKey(r, project, period))
    and batch(r).every(c => committedKey(r, c.project, c.period) or c.period <= period)
    and ((result == CommitCompleted or result == CommitSubmitted) implies sendable(r, project, period, admit))
    and (result == CommitSkipped implies not(admit))
pure def commit(r: PaymentRun, project: int, period: int, result: CommitResult, automatic: bool, inWindow: bool): PaymentRun =
  val stamped = r.pending.listMap(c => if (c.project == project and c.period == period) { ...c, lastAttempt: r.runs } else c)
  { ...r, committed: r.committed.append({ project: project, period: period }), lastResult: result,
    pending: if (result == CommitCompleted) stamped.select(c => not(c.project == project and c.period == period)) else stamped,
    failures: if (result == CommitFailed) r.failures.append(CommitMonthly) else r.failures }
pure def canFinishCommitments(r: PaymentRun): bool = r.phase == Running and r.selected and currentStep(r) == CommitMonthly
  and r.position < stepCount and batch(r).every(c => committedKey(r, c.project, c.period))
pure def finishCommitments(r: PaymentRun): PaymentRun = { ...r, position: r.position + 1 }
pure def alwaysCommitmentsBounded(r: PaymentRun): bool = r.chosen.length() <= commitmentLimit
  and r.roots.length() == r.chosen.length() and (not(r.selected) implies r.chosen.length() == 0 and r.committed.length() == 0)
pure def alwaysUnsentBatchStillPending(r: PaymentRun): bool =
  batch(r).every(c => committedKey(r, c.project, c.period) or r.pending.some(p => keyOf(p) == keyOf(c)))
pure def stepSkippedMonthStaysPending(before: PaymentRun, via: str, after: PaymentRun): bool =
  val sent = after.committed.nthOr(before.committed.length(), { project: 0, period: 0 })
  (via == "commit" and after.lastResult != CommitCompleted) implies after.pending.some(c => keyOf(c) == sent)
pure def stepNewestPeriodFirst(before: PaymentRun, via: str, after: PaymentRun): bool =
  val sent = after.committed.nthOr(before.committed.length(), { project: 0, period: 0 })
  via == "commit" implies batch(before).every(c => committedKey(before, c.project, c.period) or c.period <= sent.period)
pure def sometimesNewerMonthSentBeforeOlder(r: PaymentRun): bool =
  val first = r.committed.nthOr(0, { project: 0, period: 0 })
  val second = r.committed.nthOr(1, { project: 0, period: 0 })
  first.project > 0 and first.project == second.project and first.period > second.period
pure def sometimesSubmittedButStillPending(r: PaymentRun): bool =
  val sent = r.committed.nthOr(r.committed.length() - 1, { project: 0, period: 0 })
  r.lastResult == CommitSubmitted and sent.project > 0 and r.pending.some(c => keyOf(c) == sent)
pure def sometimesFailedCandidateWaitsBehindOthers(r: PaymentRun): bool =
  r.phase == Reported and r.failures.includes(CommitMonthly) and r.pending.some(c => c.lastAttempt > 0)
pure val projectValues = Set(1, 2)
pure val periodValues = Set(1, 2, 3)
pure val activeValues = Set(3)
pure val weight_addCandidate = 6
pure val weight_selectCommitments = 8
pure val weight_commit = 10
pure val weight_finishCommitments = 8
```

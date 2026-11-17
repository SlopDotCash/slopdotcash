# Scheduled payments runs

PRD sections 6, 11 and 12. The pinned source is `workers/payments/index.ts`
(`scheduled`). [Independent payment job runs](./paymentJobs.md) owns each
network's admission and outcome inside a step, and
[monthly commitment execution](../settlement/monthlyExecution.md) owns which
monthly commitments a run sends and in what order; this machine owns the
order of the steps of one scheduled run of the payments Worker and what a
failing step does to the others.

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
type RunPhase = Idle | Running | Reported
type PaymentRun = { phase: RunPhase, runs: int, position: int, failures: List[RunStep], reportedFailures: int,
  overlapsRefused: int }
pure val runOrder: List[RunStep] = List(SyncVaults, RecoverUncertain, ReconcileFailed, Coordinate, CommitMonthly, Dispatch)
pure val stepCount = 6
pure val initial: PaymentRun = { phase: Idle, runs: 0, position: 0, failures: List(), reportedFailures: 0,
  overlapsRefused: 0 }
pure def currentStep(r: PaymentRun): RunStep = runOrder.nthOr(r.position, Dispatch)
pure def canBegin(r: PaymentRun): bool = r.phase != Running
pure def begin(r: PaymentRun): PaymentRun = { ...r, phase: Running, runs: r.runs + 1, position: 0, failures: List(),
  reportedFailures: 0 }
pure def canRefuseOverlap(r: PaymentRun): bool = r.phase == Running
pure def refuseOverlap(r: PaymentRun): PaymentRun = { ...r, overlapsRefused: r.overlapsRefused + 1 }
pure def canAbortRun(r: PaymentRun): bool = r.phase == Running and r.position == 0
pure def abortRun(r: PaymentRun): PaymentRun =
  { ...r, phase: Reported, failures: r.failures.append(SyncVaults), reportedFailures: r.failures.length() + 1 }
pure def canSettleStep(r: PaymentRun, stepOutcome: StepOutcome): bool = r.phase == Running and r.position < stepCount
pure def settleStep(r: PaymentRun, stepOutcome: StepOutcome): PaymentRun = { ...r, position: r.position + 1,
  failures: if (stepOutcome == StepFailed) r.failures.append(currentStep(r)) else r.failures }
pure def canReport(r: PaymentRun): bool = r.phase == Running and r.position == stepCount
pure def report(r: PaymentRun): PaymentRun = { ...r, phase: Reported, reportedFailures: r.failures.length() }
pure def alwaysRunWithinItsSteps(r: PaymentRun): bool = r.position >= 0 and r.position <= stepCount
  and (r.phase == Idle implies r.position == 0 and r.failures.length() == 0 and r.runs == 0)
  and (r.phase == Reported implies (r.position == stepCount or (r.position == 0 and r.failures.includes(SyncVaults)))
    and r.reportedFailures == r.failures.length())
pure def stepFailureNeverSkipsALaterStep(before: PaymentRun, via: str, after: PaymentRun): bool =
  via == "settleStep" implies after.position == before.position + 1
pure def stepFailuresKeptUntilTheNextRun(before: PaymentRun, via: str, after: PaymentRun): bool =
  via != "begin" implies (after.failures.length() >= before.failures.length()
    and before.failures.every(f => after.failures.includes(f)))
pure def sometimesLaterStepsRanAfterAFailure(r: PaymentRun): bool =
  r.phase == Reported and r.position == stepCount and r.failures.includes(SyncVaults) and not(r.failures.includes(Dispatch))
pure def sometimesCleanRun(r: PaymentRun): bool = r.phase == Reported and r.failures.length() == 0 and r.runs > 0
pure def sometimesRunEndedByRegistryRead(r: PaymentRun): bool =
  r.phase == Reported and r.position == 0 and r.failures.includes(SyncVaults)
pure def sometimesOverlapRefused(r: PaymentRun): bool = r.overlapsRefused > 0 and r.phase == Reported
pure def sometimesCommitmentFailureReported(r: PaymentRun): bool =
  r.phase == Reported and r.failures.includes(CommitMonthly) and r.failures.length() == 1
pure val weight_settleStep = 10
pure val weight_report = 5
pure val weight_abortRun = 1
pure val weight_refuseOverlap = 2
```

# Local Solana acceptance validator stages

The existing isolated acceptance flow uses one validator and a private local
ledger. The contract shell uses two ordered validators and separately funds
its local payer in each stage. The validator wrapper validates local endpoint
identity and supplies the fresh start and shutdown receipts. Only public
program and account files may be mounted read-only. The payer key stays on
the host. The [local command supervisor](./localCommand.md) supplies the
bounded funding result for a shell stage.

Source: `formal/models/contracts/solana_validator_callers.qnt`,
`contracts/solana/scripts/test-e2e.sh` and
`scripts/escrow-acceptance/local.ts` at `8d14a969`.

## Story: Run tests only against the validator owned by the current stage

### Stage identity is fresh and readiness admits the correct next action

```quint
import localCommand as Command from "./localCommand"
type ValidatorPhase = AwaitingStage | StartingValidator | FundingValidator | TestingValidator | StoppingValidator | ValidatorStopped | ValidatorFinished
type ValidatorMode = AcceptanceCaller | ShellCaller
type ValidatorRun = { phase: ValidatorPhase, mode: ValidatorMode, stage: int, receipt: int, ledger: bool, funded: int, tests: int, stopped: bool, primaryCode: int, cleanupFailed: bool, status: int }
pure val initial: ValidatorRun = { phase: AwaitingStage, mode: AcceptanceCaller, stage: 0, receipt: 0, ledger: false, funded: 0, tests: 0, stopped: false, primaryCode: 0, cleanupFailed: false, status: -1 }
pure def stageCount(mode: ValidatorMode): int = if (mode == ShellCaller) 2 else 1
pure def canStartStage(v: ValidatorRun, mode: ValidatorMode, receipt: int, publicReadOnlyMounts: bool, localEndpoint: bool): bool =
  v.phase == AwaitingStage and v.tests == v.stage and (v.stage == 0 or v.mode == mode) and v.stage < stageCount(mode) and
    receipt > v.receipt and publicReadOnlyMounts and localEndpoint
pure def startStage(v: ValidatorRun, mode: ValidatorMode, receipt: int, publicReadOnlyMounts: bool, localEndpoint: bool): ValidatorRun =
  { ...v, phase: StartingValidator, mode: mode, stage: v.stage + 1, receipt: receipt, ledger: mode == AcceptanceCaller, stopped: false }
pure def canRecognizeReady(v: ValidatorRun, receipt: int, ownedReady: bool): bool =
  v.phase == StartingValidator and receipt == v.receipt and ownedReady
pure def recognizeReady(v: ValidatorRun, receipt: int, ownedReady: bool): ValidatorRun =
  { ...v, phase: if (v.mode == ShellCaller) FundingValidator else TestingValidator }
pure def canRecordFunding(v: ValidatorRun, funding: Command::FundingResult): bool =
  v.phase == FundingValidator and v.mode == ShellCaller and funding.receipt == v.receipt and
    funding.code >= 0 and (funding.code != 0 or funding.cleanupConfirmed)
pure def recordFunding(v: ValidatorRun, funding: Command::FundingResult): ValidatorRun =
  { ...v, phase: if (funding.code == 0) TestingValidator else StoppingValidator,
    funded: if (funding.code == 0) v.stage else v.funded, primaryCode: funding.code }
pure def canRecordTests(v: ValidatorRun, testCode: int): bool = v.phase == TestingValidator and testCode >= 0
pure def recordTests(v: ValidatorRun, testCode: int): ValidatorRun =
  { ...v, phase: StoppingValidator, tests: v.stage, primaryCode: testCode }
pure def canCancelStart(v: ValidatorRun, cancellationCode: int): bool =
  (v.phase == StartingValidator or v.phase == FundingValidator) and cancellationCode > 0
pure def cancelStart(v: ValidatorRun, cancellationCode: int): ValidatorRun =
  { ...v, phase: StoppingValidator, primaryCode: cancellationCode }
pure def alwaysCurrentStageFunded(v: ValidatorRun): bool =
  v.phase == TestingValidator and v.mode == ShellCaller implies v.funded == v.stage
pure def alwaysShellTestsWereFunded(v: ValidatorRun): bool = v.mode == ShellCaller implies v.tests <= v.funded
pure def alwaysOrderedProgress(v: ValidatorRun): bool =
  v.stage >= 0 and v.stage <= stageCount(v.mode) and v.tests >= 0 and v.tests <= v.stage and
    v.funded >= 0 and v.funded <= v.stage
```

Discovered by the proof: a stage must retain nonnegative progress and its
test and funding positions cannot pass the current stage. Without that fact,
an admissible synthetic prior state could have a future test count or a
negative funded count while entering a real stage.

### The awaited stop and its exact receipt settle cleanup

The wrapper exit or awaited API close and the matching stopped receipt are
both required. Failure ends the run while preserving its primary status.
The acceptance caller removes its ledger only after confirmed stop. An old
receipt or an open RPC port cannot authorize a second stage.

```quint
pure def canRecordStop(v: ValidatorRun, receipt: int, closeReturned: bool, closeOk: bool, ownStopped: bool): bool =
  v.phase == StoppingValidator and receipt == v.receipt and closeReturned
pure def recordStop(v: ValidatorRun, receipt: int, closeReturned: bool, closeOk: bool, ownStopped: bool): ValidatorRun =
  { ...v, phase: ValidatorStopped, stopped: closeOk and ownStopped, cleanupFailed: not(closeOk and ownStopped) }
pure def canRecordLedgerCleanup(v: ValidatorRun, removed: bool): bool =
  v.phase == ValidatorStopped and v.stopped and v.ledger and not(v.cleanupFailed)
pure def recordLedgerCleanup(v: ValidatorRun, removed: bool): ValidatorRun =
  { ...v, ledger: not(removed), cleanupFailed: not(removed) }
pure def canFinishStage(v: ValidatorRun): bool =
  v.phase == ValidatorStopped and (not(v.ledger) or v.cleanupFailed) and
    (v.primaryCode != 0 or v.cleanupFailed or (v.stopped and v.tests == v.stage and (v.mode == AcceptanceCaller or v.funded == v.stage)))
pure def finishStage(v: ValidatorRun): ValidatorRun =
  { ...v, phase: if (v.primaryCode != 0 or v.cleanupFailed or v.stage == stageCount(v.mode)) ValidatorFinished else AwaitingStage,
    status: if (v.primaryCode != 0) v.primaryCode else if (v.cleanupFailed) 1 else if (v.stage == stageCount(v.mode)) 0 else -1 }
pure def alwaysSuccessfulRunHasEachStage(v: ValidatorRun): bool =
  v.status == 0 implies v.phase == ValidatorFinished and v.stopped and not(v.ledger) and not(v.cleanupFailed) and
    v.tests == stageCount(v.mode) and (v.mode == AcceptanceCaller or v.funded == stageCount(v.mode))
pure def stepPrimaryFailureSurvivesCleanup(before: ValidatorRun, after: ValidatorRun): bool =
  before.primaryCode != 0 and after.phase == ValidatorFinished implies after.status == before.primaryCode
pure def stepReceiptNeverDecreases(before: ValidatorRun, after: ValidatorRun): bool = after.receipt >= before.receipt
pure def sometimesAcceptanceComplete(v: ValidatorRun): bool = v.mode == AcceptanceCaller and v.status == 0
pure def sometimesBothShellStagesComplete(v: ValidatorRun): bool = v.mode == ShellCaller and v.status == 0
pure def sometimesRetainedFailure(v: ValidatorRun): bool = v.status == 37 and v.cleanupFailed
```

### Simulation includes stale receipts, primary failures, and two-stage completion

```quint
pure val receiptValues = Set(0, 1, 2)
pure val fundingValues = Set(1, 2).fold(Set(), (acc, receipt) => acc.union(Set(
  { receipt: receipt, code: -1, cleanupConfirmed: false },
  { receipt: receipt, code: 0, cleanupConfirmed: true },
  { receipt: receipt, code: 0, cleanupConfirmed: false },
  { receipt: receipt, code: 1, cleanupConfirmed: false },
  { receipt: receipt, code: 37, cleanupConfirmed: true })))
pure val testCodeValues = Set(0, 7)
pure val cancellationCodeValues = Set(0, 7)
pure val weight_startStage = 12
pure val weight_recognizeReady = 8
pure val weight_recordFunding = 8
pure val weight_recordTests = 8
pure val weight_recordStop = 8
pure val weight_recordLedgerCleanup = 6
pure val weight_finishStage = 9
```

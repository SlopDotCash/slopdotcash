# Contributor discovery command completion

PRD sections 4 and 12 require the contributor to use live GitHub evidence and
handle retries and interruption without claiming a successful report from a
failed run. The source is `skills/project-contributor-template/scripts/live-report.mjs`
at `6b3b9d0b979f0608d87941f1146056a98513ffcf`. The retained Quint model is
`formal/models/contributor/contributor_command_completion.qnt`. Its source tests
are `scripts/contributor-discovery-lifetime.test.ts` and
`scripts/contributor-discovery-startup.test.ts`.

## Story: Preserve the first failure through both cleanup boundaries

### The helper retains a nonzero exit and its bounded diagnostic output

The helper waits for its owned child before cleanup. Successful command exit,
nonzero exit with retained output, and thrown failure are distinct. The shell
binds the outcome to the exact child identity. Request cleanup covers both the
owned command lease and request file. A cleanup failure becomes primary only
if no earlier failure exists. A returned nonzero result still delivers bounded
stdout and stderr to the report's normal failure handling. Those streams are
private diagnostic inputs and do not appear in public project artifacts.

```quint
type Command = PendingCommand | SuccessfulCommand | NonzeroCommand | ThrownCommand
type Failure = NoFailure | CommandFailure | RequestCleanupFailure | ReleaseFailure
type Phase = Running | CleaningRequest | Classifying | Releasing | Done
type Result = PendingExit | SuccessfulExit | FailedExit
type Completion = { phase: Phase, command: Command, primary: Failure, outputRetained: bool,
  requestCleanupFailed: bool, releaseFailed: bool, reportPublished: bool, result: Result }
pure val initial: Completion = { phase: Running, command: PendingCommand, primary: NoFailure,
  outputRetained: false, requestCleanupFailed: false, releaseFailed: false, reportPublished: false, result: PendingExit }
pure def canFinishCommand(s: Completion, commandResult: Command): bool = s.phase == Running and commandResult != PendingCommand
pure def finishCommand(s: Completion, commandResult: Command): Completion = { ...s, phase: CleaningRequest, command: commandResult,
  primary: if (commandResult == SuccessfulCommand) NoFailure else CommandFailure, outputRetained: commandResult == NonzeroCommand }
pure def canCleanupRequest(s: Completion): bool = s.phase == CleaningRequest
pure def cleanupRequest(s: Completion, failed: bool): Completion = { ...s, phase: Classifying,
  requestCleanupFailed: failed, primary: if (failed and s.primary == NoFailure) RequestCleanupFailure else s.primary }
```

### Outer release can fail after publication without erasing earlier evidence

Classify the report only after helper cleanup. A successful report writes its
output before releasing the owning discovery lock. A release failure still
makes the invocation fail. A prior command or request cleanup failure remains
the primary error. Cleanup diagnostics do not erase a prior failure or the
fact that report output was already written. This machine follows one helper
result through one report; process killing, lock recovery and stdout writes
require their corresponding shell evidence.

```quint
pure def canClassify(s: Completion): bool = s.phase == Classifying
pure def classify(s: Completion): Completion = { ...s, phase: Releasing, reportPublished: s.primary == NoFailure }
pure def canRelease(s: Completion): bool = s.phase == Releasing
pure def release(s: Completion, failed: bool): Completion = { ...s, phase: Done, releaseFailed: failed,
  primary: if (failed and s.primary == NoFailure) ReleaseFailure else s.primary,
  result: if (failed or s.primary != NoFailure) FailedExit else SuccessfulExit }
pure def alwaysCleanupOrder(s: Completion): bool =
  ((s.phase == Running or s.phase == CleaningRequest) implies not(s.requestCleanupFailed))
  and (s.phase != Done implies not(s.releaseFailed))
  and ((s.phase == Running or s.phase == CleaningRequest or s.phase == Classifying) implies not(s.reportPublished))
pure def alwaysCommand(s: Completion): bool =
  ((s.command == NonzeroCommand or s.command == ThrownCommand) implies s.primary == CommandFailure)
  and (s.outputRetained iff s.command == NonzeroCommand)
  and (s.phase != Running implies s.command != PendingCommand)
pure def alwaysCleanBeforeSuccess(s: Completion): bool = (s.primary == NoFailure and s.phase != Running) implies
  s.command == SuccessfulCommand and not(s.requestCleanupFailed) and not(s.releaseFailed)
pure def alwaysPublished(s: Completion): bool =
  (s.reportPublished implies s.command == SuccessfulCommand and not(s.requestCleanupFailed))
  and ((s.phase == Releasing and s.primary == NoFailure) implies s.reportPublished)
pure def alwaysExit(s: Completion): bool =
  (s.result == SuccessfulExit implies s.phase == Done and s.primary == NoFailure and s.reportPublished)
  and (s.result == FailedExit implies s.phase == Done and s.primary != NoFailure)
  and ((s.phase == Done) iff (s.result != PendingExit))
pure def stepFirstFailurePersists(before: Completion, via: str, after: Completion): bool =
  (before.phase != Running and before.primary != NoFailure) implies after.primary == before.primary
pure def sometimesSuccess(s: Completion): bool = s.result == SuccessfulExit
pure def sometimesFailureAfterPublication(s: Completion): bool = s.result == FailedExit and s.reportPublished
pure def sometimesBothCleanupsPreserveCommand(s: Completion): bool = s.result == FailedExit and
  s.requestCleanupFailed and s.releaseFailed and s.primary == CommandFailure and s.outputRetained
```

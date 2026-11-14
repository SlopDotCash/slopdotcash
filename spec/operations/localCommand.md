# Bound local validator funding commands

The local validator airdrop runs against loopback HTTP with a local payer. The
caller associates its result with the validator's current owned stage receipt.
The command boundary supplies the exact monotonic times, exit status, process
ownership observations and cleanup outcome. These observations come from the
supervisor and process table. A child cannot assert its own ownership.

Source: `formal/models/tooling/formal_process.qnt` and
`contracts/solana/scripts/airdrop-local.mjs` at `8d14a969`.

## Story: Reach a bounded result while keeping ownership of local processes

### Only a current local stage can start the command

```quint
type CommandPhase = Unstarted | Executing | Interrupting | Cleaning | Finished
type FundingResult = { receipt: int, code: int, cleanupConfirmed: bool }
type LocalCommand = { phase: CommandPhase, receipt: int, group: int, launchedAt: int, time: int, interruptedAt: int, code: int, exited: bool, ownedGroupGone: bool, drained: bool, cleanupOk: bool, forced: bool }
pure val initial: LocalCommand = { phase: Unstarted, receipt: 0, group: 0, launchedAt: 0, time: 0, interruptedAt: 0, code: 0, exited: false, ownedGroupGone: false, drained: false, cleanupOk: false, forced: false }
pure def canLaunch(c: LocalCommand, receipt: int, group: int, now: int, loopbackHttp: bool, localPayer: bool): bool =
  c.phase == Unstarted and receipt > 0 and group > 0 and now >= 0 and loopbackHttp and localPayer
pure def launch(c: LocalCommand, receipt: int, group: int, now: int, loopbackHttp: bool, localPayer: bool): LocalCommand =
  { ...c, phase: Executing, receipt: receipt, group: group, launchedAt: now, time: now }
```

### Cancellation or expiry requests graceful interruption before escalation

The command has a 60-second deadline. At deadline or cancellation the
supervisor requests termination from the owned group. It waits up to five
seconds for cooperation. Only the same captured and currently verified
process group may receive a forced termination. A later observation is still
required to confirm the group is gone. An ownership read failure prevents a
forced signal and can settle as unconfirmed cleanup.

```quint
pure def canInterrupt(c: LocalCommand, now: int, canceled: bool): bool =
  c.phase == Executing and now >= c.time and (canceled or now >= c.launchedAt + 60000)
pure def interrupt(c: LocalCommand, now: int, canceled: bool): LocalCommand =
  { ...c, phase: Interrupting, time: now, interruptedAt: now, code: 1 }
pure def canEscalate(c: LocalCommand, now: int, group: int, currentOwnership: bool): bool =
  c.phase == Interrupting and now >= c.time and now >= c.interruptedAt + 5000 and group == c.group and currentOwnership
pure def escalate(c: LocalCommand, now: int, group: int, currentOwnership: bool): LocalCommand =
  { ...c, phase: Cleaning, time: now, forced: true }
pure def canExitCommand(c: LocalCommand, exitCode: int, now: int): bool =
  (c.phase == Executing or c.phase == Interrupting or c.phase == Cleaning) and not(c.exited) and exitCode >= 0 and now >= c.time
pure def exitCommand(c: LocalCommand, exitCode: int, now: int): LocalCommand =
  { ...c, phase: Cleaning, time: now, exited: true, code: if (c.code != 0) c.code else if (exitCode != 0) exitCode else if (now >= c.launchedAt + 60000) 1 else 0 }
pure def stepForcedOnlyAfterGrace(before: LocalCommand, after: LocalCommand): bool =
  not(before.forced) and after.forced implies before.phase == Interrupting and after.group == before.group and after.time >= before.interruptedAt + 5000
```

### Success requires the command exit, owned group shutdown, and drained output

A bounded cleanup failure settles unsuccessfully and records any unconfirmed
facts as missing. A command failure retains its original status even if later
cleanup also fails. Cleanup only releases local resources. Results never grant
production signing authority or expose raw command output publicly.

```quint
pure def canConfirmDrained(c: LocalCommand, group: int, ownGroupGone: bool, streamsDrained: bool): bool =
  c.phase == Cleaning and c.exited and group == c.group and ownGroupGone and streamsDrained and not(c.drained)
pure def confirmDrained(c: LocalCommand, group: int, ownGroupGone: bool, streamsDrained: bool): LocalCommand =
  { ...c, ownedGroupGone: true, drained: true }
pure def canSettleCommand(c: LocalCommand, cleanupConfirmed: bool, cleanupDeadline: bool): bool =
  (c.phase == Cleaning or c.phase == Interrupting) and
    (if (cleanupConfirmed) c.exited and c.ownedGroupGone and c.drained else cleanupDeadline)
pure def settleCommand(c: LocalCommand, cleanupConfirmed: bool, cleanupDeadline: bool): LocalCommand =
  { ...c, phase: Finished, cleanupOk: cleanupConfirmed, code: if (c.code != 0) c.code else if (cleanupConfirmed) 0 else 1 }
pure def fundingResult(c: LocalCommand): FundingResult =
  { receipt: c.receipt, code: if (c.phase == Finished) c.code else -1, cleanupConfirmed: c.phase == Finished and c.cleanupOk }
pure def completedFunding(c: LocalCommand, receipt: int): bool =
  val result = fundingResult(c)
  result.receipt == receipt and result.code == 0 and result.cleanupConfirmed
pure def alwaysSuccessHasCompleteEvidence(c: LocalCommand): bool =
  c.phase == Finished and c.code == 0 implies c.exited and c.ownedGroupGone and c.drained and c.cleanupOk
pure def alwaysCommandIdentityRetained(c: LocalCommand): bool =
  c.phase != Unstarted implies c.group > 0 and c.receipt > 0
pure def stepPreservesPrimaryFailure(before: LocalCommand, after: LocalCommand): bool =
  before.code != 0 implies before.code == after.code
pure def sometimesFundingSucceeded(c: LocalCommand): bool = completedFunding(c, c.receipt)
pure def sometimesGraceExpired(c: LocalCommand): bool = c.phase == Finished and c.forced and c.code != 0
pure def sometimesFailedCleanup(c: LocalCommand): bool = c.phase == Finished and c.code == 37 and not(c.cleanupOk)
```

### Simulation exercises clock boundaries, stale ownership and cleanup failure

```quint
pure val receiptValues = Set(0, 1, 2)
pure val groupValues = Set(0, 1, 2)
pure val nowValues = Set(0, 59999, 60000, 64999, 65000)
pure val exitCodeValues = Set(0, 1, 37)
pure val weight_launch = 8
pure val weight_interrupt = 4
pure val weight_escalate = 5
pure val weight_exitCommand = 4
pure val weight_confirmDrained = 5
pure val weight_settleCommand = 2
```

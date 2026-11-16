# Independently settled payment job runs

PRD sections 6, 11 and 12 require explicit release and role authority and
independent per-network work. The retained `payment_worker_run` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf` covers scheduler admission and
network failure isolation for the fee, keeper, payment executor and referral
jobs. This model owns orchestration status. Fee keys, executor roles, release
flags and referral activation stay with their respective owning specs.
Read/sign events represent decisions, with no signer or broadcast effect.

## Story: Respect service authorization and settle each configured network independently

### Off and invalid or unauthorized configurations start no work

The configuration reader supplies the parsed service configuration, and the
role and release readers supply typed verdicts for the captured environment;
none is a caller flag. An execute mode is never permission by itself.
Schedule retries re-read configuration and role authorization. A job record
carries only its own per-network outcomes. The cron fires every minute, so a
second invocation can arrive while a run is still going; it is refused and
counted, and never shares the running job's rows.

```quint
type JobMode = Off | DryRun | Execute
type Network = Base | Ethereum | Robinhood | Solana
 type NetworkStatus = Waiting | Reading | Ready | Executing | Completed | Failed | Uncertain
 type ConfigVerdict = ValidConfig | InvalidConfig
 type AuthorityCheck = CurrentAuthority | RevokedAuthority | AuthorityUnavailable
 type ReleaseCheck = Released | NotReleased
 type ReadResult = ReadOk | ReadFailed
 type ExecutionResult = ExecutionSucceeded | ExecutionFailed | ExecutionUncertain
 type ServiceConfig = { mode: JobMode, verdict: ConfigVerdict, role: AuthorityCheck, release: ReleaseCheck, networks: Set[Network] }
 type NetworkRow = { network: Network, status: NetworkStatus }
 type JobPhase = Configuring | Running | Reported
 type Job = { phase: JobPhase, mode: JobMode, valid: bool, roleAllowed: bool, released: bool,
  rows: List[NetworkRow], runId: int, executionAdmissions: int, overlapsRefused: int }
pure val initial: Job = { phase: Configuring, mode: Off, valid: false, roleAllowed: false, released: false,
  rows: List(), runId: 0, executionAdmissions: 0, overlapsRefused: 0 }
pure val supportedNetworks: List[Network] = List(Base, Ethereum, Robinhood, Solana)
pure def networkRows(networks: Set[Network]): List[NetworkRow] = supportedNetworks
  .select(n => networks.contains(n)).listMap(n => { network: n, status: Waiting })
pure def canConfigure(j: Job): bool = j.phase == Configuring
pure def configure(j: Job, config: ServiceConfig): Job =
  { ...j, mode: config.mode, valid: config.verdict == ValidConfig, roleAllowed: config.role == CurrentAuthority,
    released: config.release == Released, rows: networkRows(config.networks) }
pure def canRefuseOverlap(j: Job, runId: int): bool = j.phase == Running and runId > j.runId
pure def refuseOverlap(j: Job, runId: int): Job = { ...j, overlapsRefused: j.overlapsRefused + 1 }
pure def sometimesOverlapRefused(j: Job): bool = j.overlapsRefused > 0 and j.phase == Reported
pure def canBegin(j: Job, runId: int): bool = j.phase == Configuring and runId > j.runId and runId > 0
  and j.mode != Off and j.valid and j.roleAllowed and j.rows.length() > 0 and (j.mode != Execute or j.released)
pure def begin(j: Job, runId: int): Job = { ...j, phase: Running, runId: runId }
```

### Dry runs can finish a read and cannot reach execution

An execute job rechecks current authority before a network starts the
signing-capable path. This state counts admissions, while signer journals own actual attempts. A read outage is isolated to the affected network.
Subsequent network reads continue while siblings fail. Actual transaction
preparation, nonce and budget reservation remain with the signer journals.

```quint
pure def rowStatus(j: Job, net: Network, status: NetworkStatus): bool = j.rows.some(row => row.network == net and row.status == status)
pure def updateRows(rows: List[NetworkRow], net: Network, prior: NetworkStatus, status: NetworkStatus): List[NetworkRow] =
  rows.listMap(row => if (row.network == net and row.status == prior) { ...row, status: status } else row)
pure def canStartRead(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and rowStatus(j, net, Waiting)
pure def startRead(j: Job, net: Network, runId: int): Job = { ...j, rows: updateRows(j.rows, net, Waiting, Reading) }
pure def canSettleRead(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and rowStatus(j, net, Reading)
pure def settleRead(j: Job, net: Network, runId: int, read: ReadResult): Job = { ...j,
  rows: updateRows(j.rows, net, Reading, if (read == ReadFailed) Failed else if (j.mode == DryRun) Completed else Ready) }
pure def canStartExecution(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and j.mode == Execute and j.released and rowStatus(j, net, Ready)
pure def startExecution(j: Job, net: Network, runId: int, role: AuthorityCheck, release: ReleaseCheck): Job =
  val admitted = role == CurrentAuthority and release == Released
  { ...j, rows: updateRows(j.rows, net, Ready, if (admitted) Executing else Failed),
    executionAdmissions: j.executionAdmissions + (if (admitted) 1 else 0) }
pure def canSettleExecution(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and rowStatus(j, net, Executing)
pure def settleExecution(j: Job, net: Network, runId: int, result: ExecutionResult): Job = { ...j, rows: updateRows(j.rows, net, Executing,
  if (result == ExecutionSucceeded) Completed else if (result == ExecutionFailed) Failed else Uncertain) }
```

### A completed summary preserves each network result and retries allocate a fresh run

Discovered by the proof, an abstract Configuring state could carry a previous
run's execution admissions. Reset and initial state both leave that count
empty before selecting the next job mode.

A missing or failed network is never reported as a success. An execution
whose outcome is unknown is reported as uncertain, never as failed or
completed; the signer journal of that network keeps the attempt open. The next run has
fresh authorization, a distinct run ID and independent terminal result. A late callback from an earlier run cannot change the new run.
Uncertain external send attempts are not retired by job retries.

```quint
pure def allTerminal(j: Job): bool = j.rows.every(row => row.status == Completed or row.status == Failed or row.status == Uncertain)
pure def canReport(j: Job): bool = j.phase == Running and allTerminal(j)
pure def report(j: Job): Job = { ...j, phase: Reported }
pure def canResetRun(j: Job): bool = j.phase == Reported
pure def resetRun(j: Job): Job = { ...initial, runId: j.runId, overlapsRefused: j.overlapsRefused }
pure def stepUncertainNeverResolvedByJob(before: Job, after: Job): bool =
  (before.phase != Configuring and after.phase != Configuring) implies
    before.rows.every(b => b.status == Uncertain implies after.rows.some(a => a.network == b.network and a.status == Uncertain))
pure def sometimesUncertainReported(j: Job): bool = j.phase == Reported and j.rows.some(row => row.status == Uncertain)
pure def alwaysReportsTerminal(j: Job): bool = j.phase == Reported implies allTerminal(j)
pure def alwaysDryNoSigning(j: Job): bool = (j.mode != Execute or j.phase == Configuring) implies j.executionAdmissions == 0
pure def alwaysRunningAuthorized(j: Job): bool = j.phase == Running implies j.mode != Off and j.valid and j.roleAllowed
pure def sometimesIndependentFailure(j: Job): bool = j.phase == Reported
  and j.rows.some(row => row.status == Failed) and j.rows.some(row => row.status == Completed)
pure def sometimesDryComplete(j: Job): bool = j.phase == Reported and j.mode == DryRun and j.executionAdmissions == 0
pure def sometimesExecuteComplete(j: Job): bool = j.phase == Reported and j.mode == Execute and j.executionAdmissions > 0
pure val runIdValues = Set(1, 2, 3)
pure val readValues = Set(ReadOk, ReadFailed)
pure val roleValues = Set(CurrentAuthority, RevokedAuthority, AuthorityUnavailable)
pure val releaseValues = Set(Released, NotReleased)
pure val resultValues = Set(ExecutionSucceeded, ExecutionFailed, ExecutionUncertain)
pure val configValues = Set(
  { mode: Execute, verdict: ValidConfig, role: CurrentAuthority, release: Released, networks: Set(Base, Solana) },
  { mode: DryRun, verdict: ValidConfig, role: CurrentAuthority, release: NotReleased, networks: Set(Ethereum, Robinhood) },
  { mode: Execute, verdict: ValidConfig, role: CurrentAuthority, release: Released, networks: Set(Base) },
  { mode: Execute, verdict: InvalidConfig, role: CurrentAuthority, release: Released, networks: Set(Base) },
  { mode: Execute, verdict: ValidConfig, role: AuthorityUnavailable, release: Released, networks: Set(Base) })
pure val weight_begin = 7
pure val weight_report = 7
pure val weight_startRead = 5
pure val weight_settleRead = 5
pure val weight_startExecution = 5
pure val weight_settleExecution = 5
```

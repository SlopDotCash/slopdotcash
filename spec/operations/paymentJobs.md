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

A caller must supply the verified service configuration and release
observations for the captured environment. An execute mode is never permission
by itself. Schedule retries re-read configuration and role authorization. A
job record carries only its own per-network outcomes.

```quint
type JobMode = Off | DryRun | Execute
type Network = Base | Ethereum | Robinhood | Solana
 type NetworkStatus = Waiting | Reading | Ready | Executing | Completed | Failed
 type NetworkRow = { network: Network, status: NetworkStatus }
 type JobPhase = Configuring | Running | Reported
 type Job = { phase: JobPhase, mode: JobMode, valid: bool, roleAllowed: bool, released: bool,
  rows: List[NetworkRow], runId: int, executionAdmissions: int }
pure val initial: Job = { phase: Configuring, mode: Off, valid: false, roleAllowed: false, released: false,
  rows: List(), runId: 0, executionAdmissions: 0 }
pure val supportedNetworks: List[Network] = List(Base, Ethereum, Robinhood, Solana)
pure def networkRows(networks: Set[Network]): List[NetworkRow] = supportedNetworks
  .select(n => networks.contains(n)).listMap(n => { network: n, status: Waiting })
pure def canConfigure(j: Job): bool = j.phase == Configuring
pure def configure(j: Job, mode: JobMode, valid: bool, roleAllowed: bool, released: bool, networks: Set[Network]): Job =
  { ...j, mode: mode, valid: valid, roleAllowed: roleAllowed, released: released, rows: networkRows(networks) }
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
pure def updateRows(rows: List[NetworkRow], net: Network, status: NetworkStatus): List[NetworkRow] =
  rows.listMap(row => if (row.network == net) { ...row, status: status } else row)
pure def canStartRead(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and rowStatus(j, net, Waiting)
pure def startRead(j: Job, net: Network, runId: int): Job = { ...j, rows: updateRows(j.rows, net, Reading) }
pure def canSettleRead(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and rowStatus(j, net, Reading)
pure def settleRead(j: Job, net: Network, runId: int, readOk: bool): Job = { ...j,
  rows: updateRows(j.rows, net, if (not(readOk)) Failed else if (j.mode == DryRun) Completed else Ready) }
pure def canStartExecution(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and j.mode == Execute and j.released and rowStatus(j, net, Ready)
pure def startExecution(j: Job, net: Network, runId: int, currentRole: bool, currentRelease: bool): Job = { ...j,
  rows: updateRows(j.rows, net, if (currentRole and currentRelease) Executing else Failed),
  executionAdmissions: j.executionAdmissions + (if (currentRole and currentRelease) 1 else 0) }
pure def canSettleExecution(j: Job, net: Network, runId: int): bool = j.phase == Running and runId == j.runId and rowStatus(j, net, Executing)
pure def settleExecution(j: Job, net: Network, runId: int, success: bool): Job = { ...j, rows: updateRows(j.rows, net, if (success) Completed else Failed) }
```

### A completed summary preserves each network result and retries allocate a fresh run

Discovered by the proof, an abstract Configuring state could carry a previous
run's execution admissions. Reset and initial state both leave that count
empty before selecting the next job mode.

A missing or failed network is never reported as a success. The next run has
fresh authorization, a distinct run ID and independent terminal result. A late callback from an earlier run cannot change the new run.
Uncertain external send attempts are not retired by job retries.

```quint
pure def allTerminal(j: Job): bool = j.rows.every(row => row.status == Completed or row.status == Failed)
pure def canReport(j: Job): bool = j.phase == Running and allTerminal(j)
pure def report(j: Job): Job = { ...j, phase: Reported }
pure def canResetRun(j: Job): bool = j.phase == Reported
pure def resetRun(j: Job): Job = { ...initial, runId: j.runId }
pure def alwaysReportsTerminal(j: Job): bool = j.phase == Reported implies allTerminal(j)
pure def alwaysDryNoSigning(j: Job): bool = (j.mode != Execute or j.phase == Configuring) implies j.executionAdmissions == 0
pure def alwaysRunningAuthorized(j: Job): bool = j.phase == Running implies j.mode != Off and j.valid and j.roleAllowed
pure def sometimesIndependentFailure(j: Job): bool = j.phase == Reported
  and j.rows.some(row => row.status == Failed) and j.rows.some(row => row.status == Completed)
pure def sometimesDryComplete(j: Job): bool = j.phase == Reported and j.mode == DryRun and j.executionAdmissions == 0
pure def sometimesExecuteComplete(j: Job): bool = j.phase == Reported and j.mode == Execute and j.executionAdmissions > 0
pure val networksValues = Set(Set(Base), Set(Base, Solana), Set(Ethereum, Robinhood))
pure val runIdValues = Set(1, 2)
pure val weight_begin = 7
pure val weight_report = 7
pure val weight_startRead = 5
pure val weight_settleRead = 5
pure val weight_startExecution = 5
pure val weight_settleExecution = 5
```

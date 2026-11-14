# Durable operator keeper lifecycle

PRD sections 6, 9 and 12 require a keeper to preserve uncertain sends and
reconcile exact evidence. The retained `operator_keeper_lifecycle` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf` covers `workers/operator-keeper/index.ts`,
`workers/operator-keeper/storage.ts` and `scripts/payment-keeper/{keeper,storage,signer,budget}.ts`.
A Durable Object belongs to one reviewed network and normalized gas wallet.
Project selection is independent of its identity. Configuration can change on
instance replacement while journal identity and liabilities remain durable.

The [RPC selection](./keeperRpc.md) and [keeper scan](./keeperScan.md) models
own endpoint truth and reconciliation-stage sequencing. The [job scheduler](../operations/paymentJobs.md)
owns per-network scheduling. This unit owns request coalescing, ephemeral
instance boundaries and one representative durable journal row. Its signed
content, exact fee and nonce rights belong to the verified signer and budget
adapters. Evidence that resolves native fees never establishes award payment.
Atomic SQLite transactions and the platform's single-instance execution need
real runtime conformance.

## Story: Connect internal requests to one live core run

### Public and wrong internal routes cannot start work

Off-mode cron returns without inspecting configuration. Invalid scheduled
configuration fails before object dispatch. Requests reaching an internal
object tick start or share its in-memory core promise. The run captures the
mode and registry configured for that instance.

```quint
type KeeperMode = Off | DryRun | Execute | InvalidMode
 type Caller = PublicRoute | WrongInternalRoute | InternalTick | Cron
 type RequestPhase = CanDispatch | Waiting | InspectBody | Done
 type RequestResult = ResultPending | NotFound | NoWork | ConfigurationError | Completed | Partial | RedactedFailure | ResponseLost | BodyError | ScheduledUnavailable | Interrupted
 type RunPhase = NoRun | SelectingMode | CheckingIdentity | Working
 type RunResult = Ran | RanPartly | RanOff | RunFailed
 type Configuration = { mode: KeeperMode, configValid: bool, registry: int, projectSelection: int }
 type RequestRow = { id: int, caller: Caller, instance: int, binding: int, phase: RequestPhase, http: int, result: RequestResult }
 type FinishedRun = { identity: int, outcome: RunResult }
 type LiveRun = { identity: int, phase: RunPhase, stagedBytes: int, attempted: bool, partial: bool }
 type Journal = { registry: int, indexed: bool, signedBytes: int, nonceHeld: bool, gasHeld: bool, gasSettled: bool, sends: int }
 type Lifecycle = { instance: int, config: Configuration, liveRun: LiveRun, latestRun: int,
  requests: List[RequestRow], results: List[FinishedRun], journal: Journal }
pure val noRun: LiveRun = { identity: 0, phase: NoRun, stagedBytes: 0, attempted: false, partial: false }
pure val offConfiguration: Configuration = { mode: Off, configValid: true, registry: 1, projectSelection: 1 }
pure val noRequest: RequestRow = { id: 0, caller: PublicRoute, instance: 0, binding: 0, phase: Done, http: 0, result: NotFound }
pure val noResult: FinishedRun = { identity: 0, outcome: RunFailed }
pure val initial: Lifecycle = { instance: 1, config: offConfiguration, liveRun: noRun, latestRun: 0,
  requests: List(), results: List(), journal: { registry: 0, indexed: false, signedBytes: 0,
    nonceHeld: false, gasHeld: false, gasSettled: false, sends: 0 } }
pure def requestRow(k: Lifecycle, requestId: int): RequestRow = k.requests.select(r => r.id == requestId).nthOr(0, noRequest)
pure def updateRequest(rows: List[RequestRow], replacement: RequestRow): List[RequestRow] =
  rows.listMap(r => if (r.id == replacement.id) replacement else r)
pure def runResult(k: Lifecycle, runId: int): FinishedRun = k.results.select(r => r.identity == runId).nthOr(0, noResult)
pure def configAccepted(config: Configuration): bool = config.configValid and config.mode != InvalidMode and config.registry > 0
pure def canConfigure(k: Lifecycle): bool = k.latestRun == 0 and k.requests.length() == 0 and k.liveRun.phase == NoRun
pure def configure(k: Lifecycle, config: Configuration): Lifecycle = { ...k, config: config }
pure def canRequest(k: Lifecycle, requestId: int): bool = requestId > 0 and requestRow(k, requestId).id == 0
pure def request(k: Lifecycle, requestId: int, caller: Caller): Lifecycle =
  val rejected = caller == PublicRoute or caller == WrongInternalRoute
  val cronOff = caller == Cron and k.config.mode == Off
  val cronInvalid = caller == Cron and not(configAccepted(k.config))
  val immediate = rejected or cronOff or cronInvalid
  { ...k, requests: k.requests.append({ id: requestId, caller: caller, instance: k.instance, binding: 0,
    phase: if (immediate) Done else CanDispatch, http: if (rejected) 404 else 0,
    result: if (rejected) NotFound else if (cronOff) NoWork else if (cronInvalid) ConfigurationError else ResultPending }) }
pure def canDispatch(k: Lifecycle, requestId: int): bool = requestRow(k, requestId).phase == CanDispatch
  and requestRow(k, requestId).instance == k.instance
pure def dispatch(k: Lifecycle, requestId: int): Lifecycle =
  val fresh = k.liveRun.phase == NoRun
  val runId = if (fresh) k.latestRun + 1 else k.liveRun.identity
  { ...k, latestRun: if (fresh) runId else k.latestRun,
    liveRun: if (fresh) { ...noRun, identity: runId, phase: SelectingMode } else k.liveRun,
    requests: updateRequest(k.requests, { ...requestRow(k, requestId), phase: Waiting, binding: runId }) }
```

### Off and failed preflight settle without invoking a signer

Mode selection occurs before durable registry identity checks. A fresh journal
can bind this instance's registry. A later different registry cannot reuse it.
The configured network and wallet identity remain the same across restarts.

```quint
pure def settleRun(conclusion: RunResult, k: Lifecycle): Lifecycle = { ...k, liveRun: noRun,
  results: k.results.append({ identity: k.liveRun.identity, outcome: conclusion }) }
pure def matchesRun(k: Lifecycle, runId: int, phase: RunPhase): bool = runId > 0 and k.liveRun.identity == runId and k.liveRun.phase == phase
pure def canSelectMode(k: Lifecycle, runId: int): bool = matchesRun(k, runId, SelectingMode)
pure def selectMode(k: Lifecycle, runId: int): Lifecycle =
  if (k.config.mode == Off) settleRun(RanOff, k)
  else if (not(configAccepted(k.config))) settleRun(RunFailed, k)
  else { ...k, liveRun: { ...k.liveRun, phase: CheckingIdentity } }
pure def canCheckIdentity(k: Lifecycle, runId: int): bool = matchesRun(k, runId, CheckingIdentity)
pure def checkIdentity(k: Lifecycle, runId: int, storageWorks: bool): Lifecycle =
  if (not(storageWorks) or (k.journal.registry != 0 and k.journal.registry != k.config.registry)) settleRun(RunFailed, k)
  else { ...k, journal: { ...k.journal, registry: k.config.registry }, liveRun: { ...k.liveRun, phase: Working } }
```

## Story: Preserve a transaction journal across lost instances and retry

### Native fee liability and nonce become durable with the exact signed bytes

Dry runs can index past evidence. An executing run stages a candidate only
under verified service signing authority. A failed storage transaction leaves
bytes, nonce and native-fee hold untouched. Staged bytes cannot broadcast.
Each broadcast consumes the committed byte identity. Missing receipts retain
those bytes and the fee hold. A finalized exact fee observation alone may
settle that liability.

```quint
pure def canIndexReads(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working)
pure def indexReads(k: Lifecycle, runId: int): Lifecycle = { ...k, journal: { ...k.journal, indexed: true } }
pure def canStageAttempt(k: Lifecycle, runId: int, bytes: int, authorized: bool): bool =
  matchesRun(k, runId, Working) and k.config.mode == Execute and authorized and bytes > 0
    and k.journal.signedBytes == 0 and not(k.liveRun.attempted)
pure def stageAttempt(k: Lifecycle, runId: int, bytes: int, authorized: bool): Lifecycle = { ...k,
  liveRun: { ...k.liveRun, stagedBytes: bytes, attempted: true } }
pure def canCommitAttempt(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working)
  and k.config.mode == Execute and k.liveRun.stagedBytes > 0 and k.journal.signedBytes == 0
pure def commitAttempt(k: Lifecycle, runId: int, storageCommitted: bool): Lifecycle =
  if (storageCommitted) { ...k, journal: { ...k.journal, signedBytes: k.liveRun.stagedBytes, nonceHeld: true,
    gasHeld: true, gasSettled: false }, liveRun: { ...k.liveRun, stagedBytes: 0 } }
  else { ...k, liveRun: { ...k.liveRun, stagedBytes: 0, partial: true } }
pure def canBroadcast(k: Lifecycle, runId: int, bytes: int): bool = matchesRun(k, runId, Working)
  and k.config.mode == Execute and bytes > 0 and bytes == k.journal.signedBytes
  and k.journal.nonceHeld and k.journal.gasHeld and not(k.journal.gasSettled)
pure def broadcast(k: Lifecycle, runId: int, bytes: int): Lifecycle = { ...k,
  journal: { ...k.journal, sends: k.journal.sends + 1 } }
pure def canRecordGasEvidence(k: Lifecycle, runId: int, bytes: int): bool = matchesRun(k, runId, Working)
  and bytes > 0 and bytes == k.journal.signedBytes and k.journal.gasHeld
pure def recordGasEvidence(k: Lifecycle, runId: int, bytes: int, exactFinalizedCharge: bool): Lifecycle =
  if (exactFinalizedCharge) { ...k, journal: { ...k.journal, gasHeld: false, gasSettled: true } }
  else { ...k, liveRun: { ...k.liveRun, partial: true } }
```

### Core completion and per-request result delivery have independent lifetimes

A core promise clears its active slot when settled. A waiting direct tick can
receive a redacted failure, no work, completion or a partial HTTP response. A
scheduled tick additionally validates the response body and treats partial
work as a failure. Losing a response changes only the waiting request.

```quint
pure def canItemFailure(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working)
pure def itemFailure(k: Lifecycle, runId: int): Lifecycle = { ...k, liveRun: { ...k.liveRun, partial: true } }
pure def canFinish(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working) and k.liveRun.stagedBytes == 0
pure def finish(k: Lifecycle, runId: int): Lifecycle = settleRun(if (k.liveRun.partial) RanPartly else Ran, k)
pure def canFatal(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working)
pure def fatal(k: Lifecycle, runId: int): Lifecycle = settleRun(RunFailed, k)
pure def canDeliver(k: Lifecycle, requestId: int): bool = requestRow(k, requestId).phase == Waiting
  and runResult(k, requestRow(k, requestId).binding).identity > 0
pure def responseRow(old: RequestRow, conclusion: RunResult, received: bool): RequestRow =
  if (not(received)) { ...old, phase: Done, result: ResponseLost }
  else if (conclusion == RunFailed) { ...old, phase: Done, http: 503, result: RedactedFailure }
  else if (old.caller == Cron) { ...old, phase: InspectBody, http: 200 }
  else { ...old, phase: Done, http: 200, result: if (conclusion == RanOff) NoWork else if (conclusion == RanPartly) Partial else Completed }
pure def deliver(k: Lifecycle, requestId: int, received: bool): Lifecycle =
  val old = requestRow(k, requestId)
  { ...k, requests: updateRequest(k.requests, responseRow(old, runResult(k, old.binding).outcome, received)) }
pure def canInspectScheduled(k: Lifecycle, requestId: int): bool = requestRow(k, requestId).phase == InspectBody
  and requestRow(k, requestId).caller == Cron
pure def inspectScheduled(k: Lifecycle, requestId: int, bodyValid: bool): Lifecycle =
  val old = requestRow(k, requestId)
  { ...k, requests: updateRequest(k.requests, { ...old, phase: Done,
    result: if (not(bodyValid)) BodyError else if (runResult(k, old.binding).outcome == RanPartly) ScheduledUnavailable else Completed }) }
```

### Restart abandons only ephemeral work and unresolved callers from that instance

An interrupted pending request cannot bind to a replacement run. Already
settled responses remain available for their original callers, even if a
new run starts first. The next instance may use the same durable attempts
only after checking the existing registry identity.

```quint
pure def canRestart(k: Lifecycle, instance: int): bool = instance > k.instance
pure def restart(k: Lifecycle, instance: int, config: Configuration): Lifecycle = { ...k,
  instance: instance, config: config, liveRun: noRun,
  requests: k.requests.listMap(r => if (r.phase == CanDispatch or
    (r.phase == Waiting and runResult(k, r.binding).identity == 0)) { ...r, phase: Done, result: Interrupted } else r) }
pure def alwaysCommitIsAtomic(k: Lifecycle): bool = k.journal.nonceHeld == (k.journal.signedBytes > 0)
  and ((k.journal.gasHeld or k.journal.gasSettled) implies k.journal.nonceHeld)
pure def alwaysSeparateGasTerminal(k: Lifecycle): bool = k.journal.gasSettled implies not(k.journal.gasHeld)
pure def stepRetainCommittedBytes(before: Lifecycle, after: Lifecycle): bool =
  before.journal.signedBytes > 0 implies after.journal.signedBytes == before.journal.signedBytes
pure def stepRestartRetainsDurableState(before: Lifecycle, via: str, after: Lifecycle): bool =
  via == "restart" implies before.journal == after.journal and before.results == after.results
pure def sometimesCoalesced(k: Lifecycle): bool = k.requests.some(a => k.requests.some(b =>
  a.id != b.id and a.binding > 0 and a.binding == b.binding))
pure def sometimesCommitted(k: Lifecycle): bool = k.journal.signedBytes > 0 and k.journal.gasHeld
pure def sometimesReplayed(k: Lifecycle): bool = k.instance > 1 and k.journal.sends > 1
pure def sometimesGasSettled(k: Lifecycle): bool = k.journal.gasSettled
pure def sometimesPartial(k: Lifecycle): bool = k.requests.some(r => r.result == ScheduledUnavailable)
pure val dryConfig: Configuration = { ...offConfiguration, mode: DryRun }
pure val executeConfig: Configuration = { ...offConfiguration, mode: Execute }
pure val configValues = Set(offConfiguration, dryConfig, executeConfig, { ...executeConfig, registry: 2 }, { ...executeConfig, configValid: false })
pure val requestIdValues = Set(1, 2, 3)
pure val runIdValues = Set(1, 2, 3)
pure val instanceValues = Set(2, 3)
pure val bytesValues = Set(1, 2)
pure val weight_request = 6
pure val weight_dispatch = 7
pure val weight_selectMode = 8
pure val weight_checkIdentity = 8
pure val weight_stageAttempt = 6
pure val weight_commitAttempt = 7
pure val weight_broadcast = 8
pure val weight_finish = 5
pure val weight_deliver = 5
pure val weight_inspectScheduled = 6
```

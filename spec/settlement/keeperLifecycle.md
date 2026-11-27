# Durable operator keeper lifecycle

PRD sections 6, 9 and 12 require a keeper to preserve uncertain sends and
reconcile exact evidence. The retained `operator_keeper_lifecycle` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf` covers `workers/operator-keeper/index.ts`,
`workers/operator-keeper/storage.ts` and `scripts/payment-keeper/{keeper,storage,signer,budget}.ts`.
A Durable Object belongs to one reviewed network and normalized gas wallet.
Project selection is independent of its identity. Configuration can change on
instance replacement while journal identity and liabilities remain durable.
The native keeper can reopen the legacy EVM journal when its API origin,
network and complete signer address match. Hexadecimal casing can differ.
It preserves the stored identity and never resets the journal or its liabilities.
Solana signer identity requires the exact address.

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
import feeReplacement as R from "./feeReplacement"
type KeeperMode = Off | DryRun | Execute | InvalidMode
 type Caller = PublicRoute | WrongInternalRoute | InternalTick | Cron
 type RequestPhase = CanDispatch | Waiting | InspectBody | Done
 type RequestResult = ResultPending | NotFound | NoWork | ConfigurationError | Completed | Partial | RedactedFailure | ResponseLost | BodyError | ScheduledUnavailable | Interrupted
 type RunPhase = NoRun | SelectingMode | CheckingIdentity | Working
 type RunResult = Ran | RanPartly | RanOff | RunFailed
 type Configuration = { mode: KeeperMode, configValid: bool, registry: int, projectSelection: int,
  replacementActivated: bool, feeCeiling: int, gasLimit: int, transactionCap: int, dayCap: int, additionalFeeReserve: int }
 type SendAttempt = { bytes: int, maxFee: int, priorityFee: int, signedAt: int, extraFee: int }
 type RequestRow = { id: int, caller: Caller, instance: int, binding: int, phase: RequestPhase, http: int, result: RequestResult }
 type FinishedRun = { identity: int, outcome: RunResult }
 type LiveRun = { identity: int, phase: RunPhase, stagedBytes: int, staged: SendAttempt, attempted: bool, partial: bool }
 type Journal = { registry: int, indexed: bool, signedBytes: int, nonceHeld: bool, gasHeld: bool, gasSettled: bool, sends: int,
  attempts: List[SendAttempt], winner: int, day: int, daySpent: int, held: int }
 type Lifecycle = { instance: int, config: Configuration, liveRun: LiveRun, latestRun: int,
  requests: List[RequestRow], results: List[FinishedRun], journal: Journal }
pure val noAttempt: SendAttempt = { bytes: 0, maxFee: 0, priorityFee: 0, signedAt: 0, extraFee: 0 }
pure val noRun: LiveRun = { identity: 0, phase: NoRun, stagedBytes: 0, staged: noAttempt, attempted: false, partial: false }
pure val offConfiguration: Configuration = { mode: Off, configValid: true, registry: 1, projectSelection: 1,
  replacementActivated: false, feeCeiling: 3000, gasLimit: 100, transactionCap: 200000, dayCap: 400000, additionalFeeReserve: 0 }
pure val noRequest: RequestRow = { id: 0, caller: PublicRoute, instance: 0, binding: 0, phase: Done, http: 0, result: NotFound }
pure val noResult: FinishedRun = { identity: 0, outcome: RunFailed }
pure val initial: Lifecycle = { instance: 1, config: offConfiguration, liveRun: noRun, latestRun: 0,
  requests: List(), results: List(), journal: { registry: 0, indexed: false, signedBytes: 0,
    nonceHeld: false, gasHeld: false, gasSettled: false, sends: 0, attempts: List(), winner: 0, day: 0, daySpent: 0, held: 0 } }
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
when the verified signer adapter reports this keeper's gas wallet as the
signing authority. A failed storage transaction leaves bytes, nonce and
native-fee hold untouched. Staged bytes cannot broadcast. Each broadcast
consumes a committed byte identity. Missing receipts retain those bytes and
the fee hold. A finalized exact fee observation alone may settle that
liability. The worst-case native cost (`maxFee × gasLimit`) must fit the
per-transaction cap and, together with what the UTC day already spent, the
daily cap.

```quint
type SignerReport = { wallet: str, expectedWallet: str }
type GasEvidence = { bytes: int, finalized: bool, charged: int }
pure def canIndexReads(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working)
pure def indexReads(k: Lifecycle, runId: int): Lifecycle = { ...k, journal: { ...k.journal, indexed: true } }
pure def cost(k: Lifecycle, maxFee: int): int = maxFee * k.config.gasLimit + k.config.additionalFeeReserve
pure def withinBudget(k: Lifecycle, maxFee: int): bool =
  maxFee > 0 and cost(k, maxFee) <= k.config.transactionCap and k.journal.daySpent + cost(k, maxFee) <= k.config.dayCap
pure def canStageAttempt(k: Lifecycle, runId: int, attempt: SendAttempt, signer: SignerReport): bool =
  matchesRun(k, runId, Working) and k.config.mode == Execute and signer.wallet != "" and signer.wallet == signer.expectedWallet
    and attempt.bytes > 0 and attempt.priorityFee >= 0 and attempt.priorityFee <= attempt.maxFee and withinBudget(k, attempt.maxFee)
    and extraFeeReserved(k, attempt.extraFee)
    and k.journal.signedBytes == 0 and not(k.liveRun.attempted)
pure def stageAttempt(k: Lifecycle, runId: int, attempt: SendAttempt, signer: SignerReport): Lifecycle = { ...k,
  liveRun: { ...k.liveRun, stagedBytes: attempt.bytes, staged: attempt, attempted: true } }
pure def canCommitAttempt(k: Lifecycle, runId: int): bool = matchesRun(k, runId, Working)
  and k.config.mode == Execute and k.liveRun.stagedBytes > 0 and k.journal.signedBytes == 0
pure def commitAttempt(k: Lifecycle, runId: int, storageCommitted: bool): Lifecycle =
  if (storageCommitted) { ...k, journal: { ...k.journal, signedBytes: k.liveRun.stagedBytes, nonceHeld: true,
    gasHeld: true, gasSettled: false, attempts: List(k.liveRun.staged), held: cost(k, k.liveRun.staged.maxFee) },
    liveRun: { ...k.liveRun, stagedBytes: 0, staged: noAttempt } }
  else { ...k, liveRun: { ...k.liveRun, stagedBytes: 0, staged: noAttempt, partial: true } }
pure def committedBytes(k: Lifecycle, bytes: int): bool = bytes > 0 and k.journal.signedBytes > 0 and k.journal.attempts.some(a => a.bytes == bytes)
pure def canBroadcast(k: Lifecycle, runId: int, bytes: int): bool = matchesRun(k, runId, Working)
  and k.config.mode == Execute and committedBytes(k, bytes)
  and k.journal.nonceHeld and k.journal.gasHeld and not(k.journal.gasSettled)
pure def broadcast(k: Lifecycle, runId: int, bytes: int): Lifecycle = { ...k,
  journal: { ...k.journal, sends: k.journal.sends + 1 } }
pure def canRecordGasEvidence(k: Lifecycle, runId: int, evidence: GasEvidence): bool = matchesRun(k, runId, Working)
  and committedBytes(k, evidence.bytes) and k.journal.gasHeld
pure def recordGasEvidence(k: Lifecycle, runId: int, evidence: GasEvidence): Lifecycle =
  if (evidence.finalized and evidence.charged >= 0 and evidence.charged <= k.journal.held)
    { ...k, journal: { ...k.journal, gasHeld: false, gasSettled: true, winner: evidence.bytes,
      daySpent: k.journal.daySpent + evidence.charged, held: 0 } }
  else { ...k, liveRun: { ...k.liveRun, partial: true } }
```

### An unmined send is replaced only by fee, same nonce and content, after activation

Replacement needs the deployment's activation flag, a held unsettled send,
and the shared [fee replacement](./feeReplacement.md) step from the original
and latest fees; every attempt keeps the same nonce. Every replaced attempt
remains retained because any one of them may be the finalized winner; exactly
one finalized outcome settles the nonce. A new UTC day resets the day's
spending but never releases an uncertain hold.

```quint
pure def latestAttempt(k: Lifecycle): SendAttempt = k.journal.attempts.nthOr(k.journal.attempts.length() - 1, noAttempt)
pure def originalAttempt(k: Lifecycle): SendAttempt = k.journal.attempts.nthOr(0, noAttempt)
pure def replacementFees(k: Lifecycle): R::Fees = R::nextReplacementFees(originalAttempt(k).maxFee, originalAttempt(k).priorityFee,
  latestAttempt(k).maxFee, latestAttempt(k).priorityFee, k.config.feeCeiling)
pure def canReplace(k: Lifecycle, runId: int, bytes: int, now: int, baseFee: int, extraFee: int): bool =
  val proposed = replacementFees(k)
  matchesRun(k, runId, Working) and k.config.mode == Execute and k.config.replacementActivated
    and replacementDue(k, now, baseFee) and extraFeeReserved(k, extraFee)
    and k.journal.signedBytes > 0 and k.journal.gasHeld and not(k.journal.gasSettled)
    and bytes > 0 and not(k.journal.attempts.some(a => a.bytes == bytes)) and proposed.ok
    and cost(k, proposed.maxFee) <= k.config.transactionCap and k.journal.daySpent + cost(k, proposed.maxFee) <= k.config.dayCap
pure def replace(k: Lifecycle, runId: int, bytes: int, now: int, baseFee: int, extraFee: int): Lifecycle =
  val proposed = replacementFees(k)
  { ...k, journal: { ...k.journal, attempts: k.journal.attempts.append({ bytes: bytes, maxFee: proposed.maxFee, priorityFee: proposed.priorityFee,
      signedAt: now, extraFee: extraFee }),
    held: cost(k, proposed.maxFee) } }
pure def canObserveDay(k: Lifecycle, day: int): bool = day > k.journal.day
pure def observeDay(k: Lifecycle, day: int): Lifecycle = { ...k, journal: { ...k.journal, day: day, daySpent: 0 } }
pure def alwaysAttemptsBounded(k: Lifecycle): bool =
  k.journal.attempts.every(a => a.bytes > 0 and a.priorityFee >= 0 and a.priorityFee <= a.maxFee
    and a.maxFee <= originalAttempt(k).maxFee * 3 and k.journal.attempts.select(o => o.bytes == a.bytes).length() == 1)
    and (k.journal.signedBytes > 0 implies originalAttempt(k).bytes == k.journal.signedBytes)
pure def alwaysOneFinalizedOutcome(k: Lifecycle): bool = (k.journal.winner > 0) == k.journal.gasSettled
  and (k.journal.winner > 0 implies k.journal.attempts.some(a => a.bytes == k.journal.winner))
pure def alwaysHoldOnlyWhileUncertain(k: Lifecycle): bool = (k.journal.held > 0) implies k.journal.gasHeld
pure def stepAttemptsRetained(before: Lifecycle, after: Lifecycle): bool =
  before.journal.signedBytes > 0 implies before.journal.attempts.every(a => after.journal.attempts.includes(a))
pure def stepHoldSurvivesMidnight(before: Lifecycle, via: str, after: Lifecycle): bool =
  via == "observeDay" implies after.journal.held == before.journal.held and after.journal.gasHeld == before.journal.gasHeld
pure def sometimesReplacedThenSettled(k: Lifecycle): bool = k.journal.attempts.length() >= 2 and k.journal.gasSettled
pure def sometimesOriginalWinsAfterReplacement(k: Lifecycle): bool = k.journal.attempts.length() >= 2
  and k.journal.winner == originalAttempt(k).bytes and k.journal.winner > 0
pure def sometimesHeldAcrossMidnight(k: Lifecycle): bool = k.journal.gasHeld and k.journal.day > 0
```

### A send becomes replaceable only after ten minutes unmined and while the base fee exceeds its max fee

The wait runs from the signing time of the latest retained attempt, so each
replacement waits ten minutes again. The latest base fee is read from the
network for each decision; while it is at or below the latest attempt's
maximum fee, or it cannot be read, the keeper only rebroadcasts the latest
journaled bytes. Development `workers/payment-executor/core.ts`
(`FEE_BUMP_POLICY.waitMs`, `replaceUnderpricedAttempt`).

```quint
pure val replacementWaitSeconds = 600
pure def replacementDue(k: Lifecycle, now: int, baseFee: int): bool =
  now - latestAttempt(k).signedAt >= replacementWaitSeconds and baseFee > latestAttempt(k).maxFee
pure val nowValues = Set(100, 700, 1400)
pure val baseFeeValues = Set(500, 5000)
```

### On Base the worst-case cost also reserves the L1 and operator fee upper bound read at one block

A Base send also pays the L1 data fee and the operator fee, which the gas
limit and fee fields do not cover. The deployment reviews a fixed additional
fee reserve; it is zero on other networks. Before each signature, original
or replacement, the budget adapter reads the GasPriceOracle's
`getL1FeeUpperBound` for the unsigned transaction's size and `getOperatorFee`
for its gas limit at one block number, and refuses when their sum exceeds the
reserve. The worst-case cost of every attempt counts the whole reserve
against the per-transaction and UTC-day caps. Development
`scripts/payment-keeper/budget.ts` (`baseOracleFee`, `budgetEvmSigner`).

```quint
pure def extraFeeReserved(k: Lifecycle, extraFee: int): bool =
  extraFee >= 0 and extraFee <= k.config.additionalFeeReserve
pure val extraFeeValues = Set(0, 4000, 6000)
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
  and ((k.journal.signedBytes > 0) == (k.journal.attempts.length() > 0))
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
pure val configValues = Set(offConfiguration, dryConfig, executeConfig, { ...executeConfig, registry: 2 }, { ...executeConfig, configValid: false },
  { ...executeConfig, replacementActivated: true }, { ...executeConfig, replacementActivated: true, additionalFeeReserve: 5000 })
pure val attemptValues = Set({ bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 },
  { bytes: 1, maxFee: 3000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 4000 })
pure val signerValues = Set({ wallet: "gas", expectedWallet: "gas" }, { wallet: "other", expectedWallet: "gas" })
pure val evidenceValues = Set({ bytes: 1, finalized: true, charged: 50000 }, { bytes: 2, finalized: true, charged: 60000 },
  { bytes: 1, finalized: false, charged: 0 })
pure val dayValues = Set(1, 2)
pure val requestIdValues = Set(1, 2, 3)
pure val runIdValues = Set(1, 2, 3)
pure val instanceValues = Set(2, 3)
pure val bytesValues = Set(1, 2, 3)
pure val weight_replace = 2
pure val weight_request = 2
pure val weight_dispatch = 2
pure val weight_selectMode = 3
pure val weight_checkIdentity = 3
pure val weight_stageAttempt = 2
pure val weight_commitAttempt = 2
pure val weight_broadcast = 3
pure val weight_finish = 2
pure val weight_deliver = 2
pure val weight_inspectScheduled = 2
pure val eval_witness_sometimesCoalesced = (
  ("configure", executeConfig),
  ("request", 1, InternalTick),
  ("request", 2, InternalTick),
  ("dispatch", 1),
  ("dispatch", 2))
pure val eval_witness_sometimesCommitted = (
  ("configure", executeConfig),
  ("request", 1, InternalTick),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("indexReads", 1),
  ("stageAttempt", 1, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { wallet: "gas", expectedWallet: "gas" }),
  ("commitAttempt", 1, true))
pure val eval_witness_sometimesHeldAcrossMidnight = (
  ("configure", executeConfig),
  ("request", 1, InternalTick),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("stageAttempt", 1, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { wallet: "gas", expectedWallet: "gas" }),
  ("commitAttempt", 1, true),
  ("observeDay", 1))
pure val eval_witness_sometimesGasSettled = (
  ("configure", executeConfig),
  ("request", 1, InternalTick),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("stageAttempt", 1, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { wallet: "gas", expectedWallet: "gas" }),
  ("commitAttempt", 1, true),
  ("recordGasEvidence", 1, { bytes: 1, finalized: true, charged: 50000 }))
pure val eval_witness_sometimesReplacedThenSettled = (
  ("configure", { ...executeConfig, replacementActivated: true }),
  ("request", 1, InternalTick),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("stageAttempt", 1, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { wallet: "gas", expectedWallet: "gas" }),
  ("commitAttempt", 1, true),
  ("replace", 1, 2, 700, 5000, 0),
  ("recordGasEvidence", 1, { bytes: 1, finalized: true, charged: 50000 }))
pure val eval_witness_sometimesOriginalWinsAfterReplacement = (
  ("configure", { ...executeConfig, replacementActivated: true }),
  ("request", 1, InternalTick),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("stageAttempt", 1, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { wallet: "gas", expectedWallet: "gas" }),
  ("commitAttempt", 1, true),
  ("replace", 1, 2, 700, 5000, 0),
  ("recordGasEvidence", 1, { bytes: 1, finalized: true, charged: 50000 }))
pure val eval_witness_sometimesReplayed = (
  ("configure", executeConfig),
  ("request", 1, InternalTick),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("stageAttempt", 1, { bytes: 1, maxFee: 1000, priorityFee: 100, signedAt: 1, extraFee: 0 }, { wallet: "gas", expectedWallet: "gas" }),
  ("commitAttempt", 1, true),
  ("broadcast", 1, 1),
  ("restart", 2, executeConfig),
  ("request", 2, InternalTick),
  ("dispatch", 2),
  ("selectMode", 2),
  ("checkIdentity", 2, true),
  ("broadcast", 2, 1))
pure val eval_witness_sometimesPartial = (
  ("configure", executeConfig),
  ("request", 1, Cron),
  ("dispatch", 1),
  ("selectMode", 1),
  ("checkIdentity", 1, true),
  ("itemFailure", 1),
  ("finish", 1),
  ("deliver", 1, true),
  ("inspectScheduled", 1, true))
```

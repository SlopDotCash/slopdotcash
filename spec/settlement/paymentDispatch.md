# Vault payment dispatch leases and finalized indexing

PRD sections 6, 8, 9 and 12 require exact finalized settlement evidence
and recovery after a partial or uncertain send. This unit owns one reserved
vault obligation's delivery queue, dispatch lease and attempt-reference
projection. Ordinary and private vault use the same rules in separated
stores. One instance is bound to its exact scope, chain deployment and
obligation. [Payment](./payment.md) owns the award amounts and financial
phase and [vault](./vault.md) owns custody and reserve accounting. Direct
payments use their own recovery. No transition here can create an obligation,
approve a wallet, sign a transaction or independently authorize a payout.

Source at `6b3b9d0b979f0608d87941f1146056a98513ffcf` includes
`backend/payments/{dispatch,ledger,verified-evidence,handler}.ts`,
`workers/payments/{index,reconcile,scanner}.ts`,
`workers/security-payments/index.ts`, and `migrations/0011_payments.sql`.
The legacy `payment_dispatch` model projects a single latest attempt and
two workers. This successor retains unique attempt and dispatch identities
for overlapping asynchronous callbacks. External evidence comes from the
current wallet authority, reviewed executor journal, and finalized chain
adapter. Real D1 transactions and replay of those external adapters require
application conformance.

## Story: Dispatch under the current outbox lease

### Acquire an exclusive token and retain the captured request identity

The clock uses nonnegative elapsed seconds. A worker can acquire a ready row
or replace a processing lease strictly
after its expiry. The lease lasts 60 seconds. The current token fences
queue mutations and new attempt creation. A dispatched request retains
its captured claim and attempt identity when another worker takes over.
Only the exact retained attempt key is sent to the idempotent executor. A queue
with an active delivery state belongs to an admitted reserved obligation.
An existing-attempt replay under a captured request can race lease takeover.
New attempt creation by a worker still requires the current lease; a
Solana binding prepare, below, is the one creation outside a lease. The executor independently
checks its bound request, current destination
authority, release and on-chain payable status before signing.

```quint
type Scope = Ordinary | PrivateBounty
type Network = Base | Ethereum | Robinhood | Solana
type Queue = NeedsWallet | Ready | Processing | Submitted | Held | Indexed
type AttemptState = NoAttempt | Prepared | Unknown | AttemptSubmitted | Failed | AttemptFinalized
type Flow = NoFlow | LeaseRead | ClaimRead | AwaitReply | Parked
type Binding = { claim: str, digest: str, address: str }
type Target = { scope: Scope, network: Network, project: str, vault: str, obligation: int, actor: int,
  asset: str, decimals: int, sourceDigest: str, termsDigest: str }
type Attempt = { key: str, binding: Binding, status: AttemptState, tx: str }
type DispatchRequest = { token: int, phase: Flow, binding: Binding, key: str }
type Inspection = { id: int, key: str, tx: str }
type FailureEvidence = { key: str, tx: str, network: Network, scope: Scope, height: int, finalized: bool, reverted: bool }
type Receipt = { target: Target, tx: str, eventIndex: int, block: str, destination: str,
  evidenceDigest: str, finalized: bool, succeeded: bool, observedAsset: bool }
type ExecutorObservation = { target: Target, key: str, tx: str, status: ObservationStatus }
type ObservationStatus = JournalUnknown | SignedUnobserved | ChainObserved | UnsignedTombstone
type Dispatch = { admitted: bool, target: Target, queue: Queue, now: int, token: int, leaseUntil: int,
  highestToken: int, wallet: Binding, authorized: List[Binding], requests: List[DispatchRequest],
  attempts: List[Attempt], inspections: List[Inspection], receipt: Receipt }
pure val noBinding: Binding = { claim: "", digest: "", address: "" }
pure val noTarget: Target = { scope: Ordinary, network: Base, project: "", vault: "", obligation: 0, actor: 0,
  asset: "", decimals: 0, sourceDigest: "", termsDigest: "" }
pure val noAttempt: Attempt = { key: "", binding: noBinding, status: NoAttempt, tx: "" }
pure val noRequest: DispatchRequest = { token: 0, phase: NoFlow, binding: noBinding, key: "" }
pure val noInspection: Inspection = { id: 0, key: "", tx: "" }
pure val noReceipt: Receipt = { target: noTarget, tx: "", eventIndex: 0, block: "", destination: "",
  evidenceDigest: "", finalized: false, succeeded: false, observedAsset: false }
pure val initial: Dispatch = { admitted: false, target: noTarget, queue: NeedsWallet, now: 0, token: 0, leaseUntil: 0,
  highestToken: 0, wallet: noBinding, authorized: List(), requests: List(), attempts: List(), inspections: List(),
  receipt: noReceipt }
pure def validTarget(target: Target): bool = target.project != "" and target.vault != "" and target.obligation > 0
  and target.actor > 0 and target.asset != "" and target.decimals >= 0 and target.sourceDigest != "" and target.termsDigest != ""
pure def validBinding(binding: Binding): bool = binding.claim != "" and binding.digest != "" and binding.address != ""
pure def canAdmit(d: Dispatch, target: Target, reservedEvidence: bool): bool = not(d.admitted) and reservedEvidence and validTarget(target)
pure def admit(d: Dispatch, target: Target, reservedEvidence: bool): Dispatch = { ...d, admitted: true, target: target }
pure def request(d: Dispatch, token: int): DispatchRequest = d.requests.select(r => r.token == token).nthOr(0, noRequest)
pure def attempt(d: Dispatch, key: str): Attempt = d.attempts.select(a => a.key == key).nthOr(0, noAttempt)
pure def inspection(d: Dispatch, inspectionId: int): Inspection = d.inspections.select(i => i.id == inspectionId).nthOr(0, noInspection)
pure def active(a: Attempt): bool = a.status == Prepared or a.status == Unknown or a.status == AttemptSubmitted
pure def firstActive(d: Dispatch): Attempt = d.attempts.select(a => active(a)).nthOr(0, noAttempt)
pure def owns(d: Dispatch, token: int): bool = token > 0 and d.queue == Processing and token == d.token
pure def putRequest(r: DispatchRequest, d: Dispatch): Dispatch =
  { ...d, requests: d.requests.listMap(old => if (old.token == r.token) r else old) }
pure def putAttempt(a: Attempt, d: Dispatch): Dispatch =
  { ...d, attempts: d.attempts.listMap(old => if (old.key == a.key) a else old) }
pure def clearLease(queue: Queue, d: Dispatch): Dispatch = { ...d, queue: queue, token: 0, leaseUntil: 0 }
pure def canAdvanceClock(d: Dispatch, currentTime: int): bool = d.admitted and d.queue != Indexed and currentTime > d.now
pure def advanceClock(d: Dispatch, currentTime: int): Dispatch = { ...d, now: currentTime }
pure def canAcquire(d: Dispatch, token: int): bool = d.admitted and token > d.highestToken
  and (d.queue == Ready or (d.queue == Processing and d.now > d.leaseUntil))
pure def acquire(d: Dispatch, token: int): Dispatch =
  { ...d, queue: Processing, token: token, highestToken: token, leaseUntil: d.now + 60,
    requests: d.requests.append({ ...noRequest, token: token, phase: LeaseRead }) }
pure def canReadClaim(d: Dispatch, token: int): bool = owns(d, token) and request(d, token).phase == LeaseRead
pure def readClaim(d: Dispatch, token: int): Dispatch =
  putRequest({ ...request(d, token), phase: ClaimRead, binding: d.wallet, key: firstActive(d).key }, d)
pure def canPrepare(d: Dispatch, token: int, key: str): bool =
  val r = request(d, token)
  owns(d, token) and r.phase == ClaimRead and validBinding(r.binding)
    and r.key == "" and firstActive(d).key == "" and key != "" and attempt(d, key).key == ""
pure def prepare(d: Dispatch, token: int, key: str): Dispatch =
  putRequest({ ...request(d, token), phase: AwaitReply, key: key },
    { ...d, attempts: d.attempts.append({ key: key, binding: request(d, token).binding, status: Prepared, tx: "" }) })
pure def canReuse(d: Dispatch, token: int): bool =
  val r = request(d, token)
  val a = attempt(d, r.key)
  d.queue != Indexed and r.phase == ClaimRead and a.key != "" and active(a) and a.binding == r.binding
pure def reuse(d: Dispatch, token: int): Dispatch =
  putRequest({ ...request(d, token), phase: AwaitReply }, d)
```

### New wallet authority keeps an uncertain former wallet attempt held

A current authorized claim comes from the wallet authority. It retains
historical wallet consent for later exact chain receipts. A queue with an
unresolved attempt under a different claim cannot become ready merely
because the wallet changed. The dispatcher parks a mismatching read under
its own lease. If worker recovery already retired its captured unsigned
attempt, it releases that lease to ready instead. An old response may
still describe a payment originally submitted under the former claim. A
verified change that leaves no currently authorized claim removes the current
binding while preserving prior claims, the queue and all attempt records.

```quint
pure def canAuthorizeWallet(d: Dispatch, binding: Binding, verifiedWallet: bool): bool =
  d.admitted and d.queue != Indexed and verifiedWallet and validBinding(binding)
    and d.authorized.every(old => old.claim != binding.claim or old == binding)
pure def mayRelease(d: Dispatch, binding: Binding): bool =
  validBinding(binding) and d.attempts.every(a => not(active(a)) or a.binding == binding)
pure def authorizeWallet(d: Dispatch, binding: Binding, verifiedWallet: bool): Dispatch =
  { ...d, wallet: binding, authorized: if (d.authorized.includes(binding)) d.authorized else d.authorized.append(binding),
    queue: if ((d.queue == NeedsWallet or d.queue == Held) and mayRelease(d, binding)) Ready else d.queue }
pure def canClearCurrentWallet(d: Dispatch, binding: Binding, verifiedChange: bool): bool =
  d.admitted and d.queue != Indexed and verifiedChange and validBinding(binding) and d.wallet == binding
pure def clearCurrentWallet(d: Dispatch, binding: Binding, verifiedChange: bool): Dispatch =
  { ...d, wallet: noBinding }
pure def canPark(d: Dispatch, token: int): bool =
  val r = request(d, token)
  val a = attempt(d, r.key)
  owns(d, token) and r.phase == ClaimRead and
    (not(validBinding(r.binding)) or (a.key != "" and a.binding != r.binding))
pure def park(d: Dispatch, token: int): Dispatch =
  val r = request(d, token)
  val a = attempt(d, r.key)
  val queue = if (a.status == Failed and a.tx == "") Ready else Held
  clearLease(queue, putRequest({ ...r, phase: Parked }, d))
pure def canReturnAmbiguous(d: Dispatch, token: int): bool =
  request(d, token).phase == AwaitReply
pure def returnAmbiguous(d: Dispatch, token: int): Dispatch =
  val a = attempt(d, request(d, token).key)
  val recorded = if (a.status == Prepared or a.status == Unknown) putAttempt({ ...a, status: Unknown }, d) else d
  if (owns(d, token)) clearLease(Ready, recorded) else recorded
pure def canReturnSuccess(d: Dispatch, token: int, tx: str): bool =
  request(d, token).phase == AwaitReply and tx != "" and request(d, token).key != ""
pure def returnSuccess(d: Dispatch, token: int, tx: str): Dispatch =
  val a = attempt(d, request(d, token).key)
  val unique = d.attempts.every(other => other.key == a.key or other.tx != tx)
  val accepted = unique and ((a.tx == "" and (active(a) or a.status == Failed)) or (a.tx == tx and active(a)))
  val recorded = if (accepted) putAttempt({ ...a, tx: tx, status: AttemptSubmitted }, d) else d
  if (owns(d, token)) clearLease(if (accepted) Submitted else Held, recorded) else recorded
```

### A Solana binding prepare creates the first attempt for the current claim only while the outbox is ready

An authenticated Solana recipient's prepare (`POST /wallets/solana-bind/prepare`)
may create the obligation's first prepared attempt, for the current
authorized claim, only while its outbox row is ready and no prepared,
unknown or submitted attempt exists, in one atomic write; the lease is not
taken. A concurrent prepare, and a dispatcher that acquires the row first
or later, share that one attempt: the dispatcher reads it as the active
attempt of the same claim and reuses it. An active attempt of an earlier
claim keeps the obligation until it is reconciled. The completion of the
binding never creates an attempt. The private security ledger follows the
same rule (development `backend/payments/handler.ts` 1134-1175,
`solana-bind-attempt.test.ts`, and `backend/payments/README.md`).

```quint
pure def canPrepareBinding(d: Dispatch, key: str, binding: Binding): bool =
  d.admitted and d.queue == Ready and d.target.network == Solana and validBinding(binding) and binding == d.wallet
    and firstActive(d).key == "" and key != "" and attempt(d, key).key == ""
pure def prepareBinding(d: Dispatch, key: str, binding: Binding): Dispatch =
  { ...d, attempts: d.attempts.append({ key: key, binding: binding, status: Prepared, tx: "" }) }
pure def sometimesBindingPreparedBeforeDispatch(d: Dispatch): bool =
  d.queue == Ready and d.requests.length() == 0 and d.attempts.some(a => a.status == Prepared)
```

## Story: Recover uncertainty without opening a competing transfer

### Classify the exact executor journal result

A trusted, scope-matched journal may report a submitted transaction, signed
bytes without observed submission, or retirement of an unsigned attempt
under a superseded wallet claim. A null, missing, outdated or unavailable
observation cannot retire an attempt. The reviewed executor's tombstone
and signing commit serialize on the same key. The worker preserves a live
lease during retirement. A stale unsigned retirement cannot reopen a
successor's row. Solana may reopen an earlier recorded submission that the
reviewed journal says was never observed, retaining its attempt key for
identical signed-byte retry or the executor's separate expiry procedure.

```quint
pure def canRecoverExecutor(d: Dispatch, observed: ExecutorObservation): bool =
  d.admitted and d.queue != Indexed and observed.target == d.target and observed.key != "" and attempt(d, observed.key).key != ""
pure def acceptJournalSubmission(observed: ExecutorObservation, a: Attempt, d: Dispatch): Dispatch =
  val unique = d.attempts.every(other => other.key == a.key or other.tx != observed.tx)
  val matches = observed.tx != "" and unique and (a.tx == "" or a.tx == observed.tx) and active(a)
  if (matches) clearLease(Submitted, putAttempt({ ...a, tx: observed.tx, status: AttemptSubmitted }, d)) else d
pure def reopenUnseen(observed: ExecutorObservation, a: Attempt, d: Dispatch): Dispatch =
  val matches = d.target.network == Solana and a.status == AttemptSubmitted and a.tx != "" and a.tx == observed.tx
  val updated = if (matches) putAttempt({ ...a, status: Unknown, tx: "" }, d) else d
  if (matches and d.queue == Submitted) clearLease(Ready, updated) else updated
pure def retireUnsigned(observed: ExecutorObservation, a: Attempt, d: Dispatch): Dispatch =
  val eligible = (a.tx == "" and (a.status == Prepared or a.status == Unknown))
    or (d.target.network == Solana and a.status == AttemptSubmitted)
  val retires = observed.tx == "" and eligible and validBinding(d.wallet) and a.binding != d.wallet
  val updated = if (retires) putAttempt({ ...a, status: Failed, tx: "" }, d) else d
  if (retires and not(d.queue == Processing and d.leaseUntil > d.now)) clearLease(Ready, updated) else updated
pure def recoverExecutor(d: Dispatch, observed: ExecutorObservation): Dispatch =
  val a = attempt(d, observed.key)
  if (observed.status == ChainObserved) acceptJournalSubmission(observed, a, d)
  else if (observed.status == SignedUnobserved) reopenUnseen(observed, a, d)
  else if (observed.status == UnsignedTombstone) retireUnsigned(observed, a, d)
  else d
```

### A reverted receipt names the attempt observed before the asynchronous read

Reconcilers can independently capture the same attempt and transaction.
Only a finalized exact revert can retire it. A stale observation cannot
touch the successor or reopen its outbox. An in-flight inspection may
retain failure on its original attempt after another transaction is indexed,
while the canonical receipt and indexed queue stay fixed. A current ready or processing row
keeps its state. Missing receipts and unfinalized failures preserve uncertainty.

```quint
pure def canInspectFailure(d: Dispatch, inspectionId: int, key: str): bool =
  val a = attempt(d, key)
  d.queue != Indexed and inspectionId > 0 and inspection(d, inspectionId).id == 0
    and a.tx != "" and (a.status == AttemptSubmitted or a.status == Unknown)
pure def inspectFailure(d: Dispatch, inspectionId: int, key: str): Dispatch =
  { ...d, inspections: d.inspections.append({ id: inspectionId, key: key, tx: attempt(d, key).tx }) }
pure def canSettleFailure(d: Dispatch, inspectionId: int): bool =
  inspectionId > 0 and inspection(d, inspectionId).id != 0
pure def settleFailure(d: Dispatch, inspectionId: int, failure: FailureEvidence): Dispatch =
  val captured = inspection(d, inspectionId)
  val a = attempt(d, captured.key)
  val exact = failure.key == captured.key and failure.tx == captured.tx and a.tx == captured.tx
    and failure.scope == d.target.scope and failure.network == d.target.network and failure.height > 0
    and failure.finalized and failure.reverted and (a.status == AttemptSubmitted or a.status == Unknown)
  val updated = if (exact) putAttempt({ ...a, status: Failed }, d) else d
  if (exact and (d.queue == Submitted or d.queue == Held) and firstActive(updated).key == "") clearLease(Ready, updated)
  else updated
```

## Story: Index the canonical finalized payment independently of callback order

### A scanner receipt commits through the canonical financial owner

The canonical handoff is `canIndexFinalized` followed by
`indexFinalized` in the same commit as the financial owner's reserved-to-paid
transition. The receipt carries exact reviewed network, payout scope, project,
vault, obligation, contributor, asset and decimals, source and payout terms,
transaction, event index, finalized block, destination, and immutable
evidence digest. The terms digest binds the canonical gross, principal, fee
and fee recipient verified by the financial owner and chain adapter.
`observedAsset` attests the matching finalized vault asset snapshot.
The destination must match an authorized historical claim for this
obligation's actor and chain. The transaction can match a retained dispatch
attempt, appear before a callback records it, or differ from the attempted
transaction. A matching attempt reference becomes finalized. Other attempt
records remain available for audit. An exact replay is idempotent. A second
receipt cannot change the retained canonical receipt. The guard applies to
the current committed receipt, including when two scanner validations overlapped
before commit. Native dispatch can still retain an already in-flight executor
reply after indexing because its attempt update is independent of the
outbox-token check. Neither that reply nor an in-flight failure observation can
change the indexed queue, canonical transaction, or payout amounts. A late
callback naming the canonical transaction can leave its attempt labeled
submitted when the scanner had no transaction to associate during indexing.

The [atomic settlement](./composition.md) applies this receipt alongside
the actor-owned vault reservation and the financial obligation. [Payment](./payment.md)
matches its immutable amounts and fee recipient, while the outbox verifies
historical wallet consent and finalized event identity. The independent direct
rails require their existing attempt evidence.

```quint
pure def exactReceipt(d: Dispatch, receipt: Receipt): bool =
  d.admitted and receipt.target == d.target and receipt.tx != "" and receipt.eventIndex >= 0 and receipt.block != ""
    and receipt.evidenceDigest != "" and receipt.finalized and receipt.succeeded and receipt.observedAsset
    and d.authorized.some(binding => binding.address == receipt.destination)
pure def canIndexFinalized(d: Dispatch, receipt: Receipt): bool =
  exactReceipt(d, receipt) and (d.queue != Indexed or d.receipt == receipt)
pure def indexFinalized(d: Dispatch, receipt: Receipt): Dispatch =
  if (d.queue == Indexed) d
  else clearLease(Indexed, { ...d, receipt: receipt, attempts: d.attempts.listMap(a =>
    if (a.tx == receipt.tx) { ...a, status: AttemptFinalized } else a) })
pure def alwaysLeaseShape(d: Dispatch): bool =
  if (d.queue == Processing) d.token > 0 and d.leaseUntil > 0 else d.token == 0 and d.leaseUntil == 0
pure def alwaysIndexedHasExactReceipt(d: Dispatch): bool = d.queue == Indexed implies exactReceipt(d, d.receipt)
pure def alwaysActiveQueueHasObligation(d: Dispatch): bool = d.queue != NeedsWallet implies d.admitted
pure def alwaysClockAndTokenDomain(d: Dispatch): bool = d.now >= 0 and d.highestToken >= 0
pure def stepIndexedIsAbsorbing(before: Dispatch, after: Dispatch): bool = before.queue == Indexed implies
  after.queue == Indexed and before.receipt == after.receipt and after.token == 0 and after.leaseUntil == 0
    and after.wallet == before.wallet and after.requests == before.requests
pure def stepTargetIsImmutable(before: Dispatch, after: Dispatch): bool = before.admitted implies before.target == after.target
pure def stepNoReceiptFromDispatch(before: Dispatch, via: str, after: Dispatch): bool =
  via != "indexFinalized" implies before.receipt == after.receipt
pure def sometimesUnknown(d: Dispatch): bool = d.attempts.some(a => a.status == Unknown)
pure def sometimesExternalIndex(d: Dispatch): bool = d.queue == Indexed and d.attempts.every(a => a.tx != d.receipt.tx)
pure def sometimesHeld(d: Dispatch): bool = d.queue == Held
pure def sometimesRetried(d: Dispatch): bool = d.requests.some(a => d.requests.some(b =>
  a.token < b.token and a.phase == AwaitReply and b.phase == AwaitReply and a.key == b.key))
```

### Finite inputs exercise overlapping leases, claims and receipts

The sampled identifiers and times bound simulation only.

```quint
pure val ordinaryTarget: Target = { ...noTarget, project: "project", vault: "vault", actor: 9,
  obligation: 1, asset: "token", decimals: 9, sourceDigest: "source", termsDigest: "terms" }
pure val privateTarget: Target = { ...ordinaryTarget, scope: PrivateBounty, network: Solana }
pure val targetValues = Set(ordinaryTarget, privateTarget)
pure val walletOne: Binding = { claim: "claim-one", digest: "claim-digest-one", address: "wallet-one" }
pure val walletTwo: Binding = { claim: "claim-two", digest: "claim-digest-two", address: "wallet-two" }
pure val bindingValues = Set(walletOne, walletTwo)
pure val verifiedWalletValues = Set(true, false)
pure val verifiedChangeValues = Set(true, false)
pure val tokenValues = Set(1, 2, 3)
pure val keyValues = Set("attempt-one", "attempt-two")
pure val txValues = Set("tx-one", "tx-two", "tx-external")
pure val currentTimeValues = Set(60, 61, 121, 122, 200)
pure val inspectionIdValues = Set(1, 2)
pure val paidReceipt: Receipt = { target: ordinaryTarget, tx: "tx-external", eventIndex: 0, block: "final-block",
  destination: walletOne.address, evidenceDigest: "verified-payment", finalized: true, succeeded: true, observedAsset: true }
pure val receiptValues = Set(paidReceipt, { ...paidReceipt, tx: "tx-one" }, { ...paidReceipt, target: privateTarget },
  { ...paidReceipt, destination: walletTwo.address }, { ...paidReceipt, finalized: false })
pure val reverted: FailureEvidence = { key: "attempt-one", tx: "tx-one", scope: Ordinary, network: Base,
  height: 1, finalized: true, reverted: true }
pure val failureValues = Set(reverted, { ...reverted, finalized: false }, { ...reverted, key: "attempt-two" })
pure val missingJournal: ExecutorObservation = { target: ordinaryTarget, key: "attempt-one", tx: "", status: JournalUnknown }
pure val observedValues = Set(missingJournal, { ...missingJournal, tx: "tx-one", status: ChainObserved },
  { ...missingJournal, status: UnsignedTombstone }, { ...missingJournal, target: privateTarget, tx: "tx-one", status: SignedUnobserved })
pure val weight_admit = 5
pure val weight_authorizeWallet = 5
pure val weight_acquire = 5
pure val weight_readClaim = 5
pure val weight_prepare = 5
pure val weight_reuse = 4
pure val weight_returnAmbiguous = 4
pure val weight_returnSuccess = 4
```

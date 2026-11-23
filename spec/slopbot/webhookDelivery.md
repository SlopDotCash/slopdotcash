# Slopbot webhook delivery and retained sources

PRD sections 5 and 7 restrict review and scoring to the current registered
scope and preserve maintainer reopen decisions. This unit owns one GitHub
delivery ID's receipt and independent valuation and reopen source bindings.
The review, value and appeal consumers own their eventual decisions. The
webhook may queue work without knowing whether it will later be authorized.

At pinned source `78eed5564d796119d82ae541c36b0c770263dc5f`,
`workers/slopbot/index.ts` verifies the body and selects work,
`persistence.ts` owns the receipt, `value-requests.ts` and
`reopen-source.ts` pin their independent source identities, and
`review.ts` checks the current maintainer before confirming a reopen.
The retained `bot_webhook_delivery` model assumes a general original
payload binding and requires a queue send before completion. Actual ordinary
receipts store an event name and processed time. They also complete for
ignored, valuation-only, refused and no-decision outcomes.

## Story: Authenticate exact bytes before claiming a receipt

### Bounded bytes and strict object decoding are required

The route accepts POST to `/github/webhook`. Read up to 25 MiB from the
stream even when its declared length is absent or inaccurate. Check the
HMAC-SHA256 signature of the exact received byte buffer before extracting
the delivery ID, decoding fatal UTF-8 and parsing a non-null JSON object
that is not an array. A corrected signed request may retry after any ingress
refusal with the same delivery ID. Byte, signature, and strict parsing truth
belong to the native adapter. The model passes one immutable byte record,
its digest and the count of bytes actually read, between those adapter
operations, so the size bound, the signature and the decoder all refer to
the same buffer. The read stops one byte past the limit. Nothing writes the
body or signature to storage.

```quint
import repositoryScope as RS from "./repositoryScope"
import installation as I from "./installation"
type Bytes = { digest: str, length: int }
type GithubEvent = Installation | PullRequest | Issue | PullReview | ReviewComment | IssueComment | Other
type Ingress = AwaitingSignature | AwaitingDecode | CanClaim | InspectValue | InspectQueue | PersistReopen | SendQueue | AwaitCompletion | InstallPending | Disposed
type Outcome = NoReply | WrongRoute | TooLarge | WrongSignature | Malformed | Duplicate | NotRegistered
  | ReopenUnavailable | Ignored | ValuationPending | Queued | Failed
type OrdinaryReceipt = NoReceipt | PendingReceipt | ProcessedReceipt
type JobKind = NoJob | Review | Appeal | AppealCommand | HumanReopen
type JobScope = NoScope | OrdinaryReview | SecurityReview | ReversalWork
type ItemKind = IssueItem | PullItem
type ItemState = OpenItem | ClosedByBot | ClosedByOther | ClosedUnknown
type ReopenDecision = NoDecision | AuthorAppeal | MaintainerDecision
type Ack = QueuedAndAcked | QueueRejected | QueuedAckLost
type ValueSource = { installation: int, repository: int, owner: str, repo: str, pull: int }
type ReopenSource = { installation: int, repository: int, kind: ItemKind, number: int,
  sender: int, node: str, revision: str, occurred: int }
type ReopenObservation = { source: ReopenSource, node: str, currentRevision: str, author: int,
  itemState: ItemState, maintainer: bool, existingDebit: bool, reversalOnly: bool }
type Body = { event: GithubEvent, deliveryId: str, valueCandidate: bool, value: ValueSource,
  job: JobKind, reopen: ReopenSource, publicRepo: bool, selfSender: bool, qualityReceipt: bool,
  change: I::InstallEvent }
type Request = { id: int, bytes: Bytes, phase: Ingress, status: int, result: Outcome, body: Body,
  valued: bool, scope: JobScope, completion: Outcome }
type Webhook = { deliveryId: str, receipt: OrdinaryReceipt, firstEvent: GithubEvent, exists: bool,
  installationProcessed: bool, value: ValueSource, reopen: ReopenSource, confirmed: bool,
  requests: List[Request], sends: int, install: I::Installation, installDelivery: int }
pure val noValue: ValueSource = { installation: 0, repository: 0, owner: "", repo: "", pull: 0 }
pure val noReopen: ReopenSource = { installation: 0, repository: 0, kind: IssueItem, number: 0,
  sender: 0, node: "", revision: "", occurred: 0 }
pure val noChange: I::InstallEvent = { delivery: 0, kind: I::OtherInstallAction, sourceTime: 0, hasAccount: false,
  validTime: false }
pure val noBody: Body = { event: Other, deliveryId: "", valueCandidate: false, value: noValue,
  job: NoJob, reopen: noReopen, publicRepo: false, selfSender: false, qualityReceipt: false, change: noChange }
pure val noBytes: Bytes = { digest: "", length: 0 }
pure val noRequest: Request = { id: 0, bytes: noBytes, phase: Disposed, status: 0, result: NoReply,
  body: noBody, valued: false, scope: NoScope, completion: NoReply }
pure val initial: Webhook = { deliveryId: "", receipt: NoReceipt, firstEvent: Other, exists: false,
  installationProcessed: false, value: noValue, reopen: noReopen, confirmed: false, requests: List(), sends: 0,
  install: I::initial, installDelivery: 0 }
pure def request(w: Webhook, requestId: int): Request = w.requests.select(r => r.id == requestId).nthOr(0, noRequest)
pure def updateRequest(r: Request, w: Webhook): Webhook =
  { ...w, requests: w.requests.listMap(old => if (old.id == r.id) r else old) }
pure def answer(r: Request, status: int, reply: Outcome, w: Webhook): Webhook =
  updateRequest({ ...r, phase: Disposed, status: status, result: reply }, w)
pure def canReceive(w: Webhook, requestId: int): bool = requestId > 0 and request(w, requestId).id == 0
pure def receive(w: Webhook, requestId: int, bytes: Bytes, route: bool): Webhook =
  val bounded = bytes.length >= 0 and bytes.length <= 26214400 and bytes.digest != ""
  val accepted = route and bounded
  { ...w, requests: w.requests.append({ ...noRequest, id: requestId, bytes: bytes,
    phase: if (accepted) AwaitingSignature else Disposed, status: if (accepted) 0 else if (route) 413 else 404,
    result: if (accepted) NoReply else if (route) TooLarge else WrongRoute }) }
pure def canAuthenticate(w: Webhook, requestId: int): bool = request(w, requestId).phase == AwaitingSignature
pure def authenticate(w: Webhook, requestId: int, signedBytes: Bytes, verifiedHmac: bool): Webhook =
  val r = request(w, requestId)
  if (verifiedHmac and signedBytes == r.bytes) updateRequest({ ...r, phase: AwaitingDecode }, w)
  else answer(r, 401, WrongSignature, w)
pure def canDecode(w: Webhook, requestId: int): bool = request(w, requestId).phase == AwaitingDecode
pure def decode(w: Webhook, requestId: int, decodedBytes: Bytes, strictUtf8: bool, jsonObject: bool, body: Body): Webhook =
  val r = request(w, requestId)
  val changeParsed = if (body.event == Installation) body.change.delivery > 0 and body.change.sourceTime >= 0
    else body.change == noChange
  if (decodedBytes == r.bytes and strictUtf8 and jsonObject and body.deliveryId != "" and changeParsed and
    (w.deliveryId == "" or body.deliveryId == w.deliveryId))
    updateRequest({ ...r, body: body, phase: CanClaim }, w)
  else answer(r, 400, Malformed, w)
```

## Story: Record the delivery and make independent routing decisions

### An ordinary pending receipt does not claim exclusive execution

A processed receipt replies as duplicate before the value or queue path.
Concurrent pending requests can both advance. Installation receipts use
a separate completion flag and require the retained event to have the
installation kind. The change applied is the one decoded from the
authenticated bytes of this delivery, and the first claimed request fixes
its GitHub delivery number, so a request for the same delivery ID cannot
apply a different change. The [installation](./installation.md) change, its
owner notices and the completion flag commit in one batch. This machine
holds one delivery ID; the order of changes across deliveries is checked
in the installation unit. A failed batch or an
invalid GitHub source time leaves the flag unset, so a redelivery retries
without running ordinary release. Ordinary release deletes the receipt only
when no reopen source was retained and no value request names this
delivery: `slopbot_value_requests.delivery_id` references the receipt, so
the delete fails and the receipt stays (`releaseDelivery` in
`persistence.ts`; migration `0050`).

```quint
pure def canClaim(w: Webhook, requestId: int): bool =
  val r = request(w, requestId)
  r.phase == CanClaim and (w.deliveryId == "" or r.body.deliveryId == w.deliveryId)
pure def claim(w: Webhook, requestId: int): Webhook =
  val r = request(w, requestId)
  val installation = r.body.event == Installation
  val duplicate = if (installation) w.exists and (w.firstEvent != Installation or w.installationProcessed)
    else w.receipt == ProcessedReceipt
  val stored = if (w.exists) w else { ...w, exists: true, deliveryId: r.body.deliveryId,
    firstEvent: r.body.event, receipt: PendingReceipt,
    installDelivery: if (w.installDelivery == 0) r.body.change.delivery else w.installDelivery }
  if (duplicate) answer(r, 202, Duplicate, w)
  else updateRequest({ ...r, phase: if (installation) InstallPending else InspectValue }, stored)
pure def canFinishInstallation(w: Webhook, requestId: int, committed: bool): bool =
  request(w, requestId).phase == InstallPending and w.exists and w.firstEvent == Installation
    and request(w, requestId).body.change.delivery == w.installDelivery and w.installDelivery > 0
pure def finishInstallation(w: Webhook, requestId: int, committed: bool): Webhook =
  val r = request(w, requestId)
  val change = r.body.change
  if (committed and I::canDeliver(w.install, change) and (change.validTime or not(change.hasAccount)))
    answer(r, 202, Ignored, { ...w, installationProcessed: true, install: I::deliver(w.install, change) })
  else if (committed and I::canDeliver(w.install, change)) answer(r, 500, Failed, { ...w, install: I::deliver(w.install, change) })
  else answer(r, 503, Failed, w)
pure def releaseOrdinary(r: Request, w: Webhook): Webhook =
  answer(r, 503, Failed, if (w.reopen != noReopen or w.value != noValue) w
    else { ...w, receipt: NoReceipt, exists: false, installationProcessed: false, firstEvent: Other })
```

### Current registration determines valuation and queue scope

The strict payload adapter derives the native `VALUE_ACTIONS` and `jobFor`
outputs from authenticated bytes. It recognizes GitHub's exact event/action
pairs, normalizes source identifiers and comment commands, and keeps only
known kinds. Ordinary review excludes a private repository and self-sent
work except the exact recognized quality-comment marker and comment identity.
Only active contributor registration can write the immutable value request,
and only while the receipt it references exists.
The guarded write compares installation, repository ID, owner/name and PR
number for the same delivery. It independently rechecks registration. A
paused, flagged or quarantined project can queue security-only review.
A retired registered project can queue appeal, appeal command or human
reopen for reversal only. Registration lookup errors are recoverable
failures. An absent job may finish as ignored or valuation pending.

```quint
pure def validValue(v: ValueSource): bool = v.installation > 0 and v.repository > 0 and v.pull > 0
  and v.owner != "" and v.repo != ""
pure def canInspectValue(w: Webhook, requestId: int): bool = request(w, requestId).phase == InspectValue
pure def inspectValue(w: Webhook, requestId: int, registration: RS::RegistryObservation,
  writeRegistration: RS::RegistryObservation, lookupOk: bool): Webhook =
  val r = request(w, requestId)
  val wants = r.body.valueCandidate and RS::slopbotScope(registration) == RS::Contributor
  val value = r.body.value
  val conflict = wants and (not(w.exists) or RS::slopbotScope(writeRegistration) != RS::Contributor or not(validValue(value))
    or (w.value != noValue and w.value != value))
  if (not(lookupOk) or conflict) releaseOrdinary(r, w)
  else updateRequest({ ...r, phase: InspectQueue, valued: wants },
    { ...w, value: if (wants) value else w.value })
pure def qualifiedJob(body: Body): JobKind =
  if (not(body.publicRepo) or (body.selfSender and not(body.job == Review and body.qualityReceipt))) NoJob
  else body.job
pure def queueScope(job: JobKind, scope: RS::Scope): JobScope =
  if (job == NoJob) NoScope
  else if (scope == RS::Contributor) OrdinaryReview
  else if (scope == RS::SecurityOnly) SecurityReview
  else if (scope == RS::ReversalOnly and (job == Appeal or job == AppealCommand or job == HumanReopen)) ReversalWork
  else NoScope
pure def canInspectQueue(w: Webhook, requestId: int): bool = request(w, requestId).phase == InspectQueue
pure def inspectQueue(w: Webhook, requestId: int, registration: RS::RegistryObservation, lookupOk: bool): Webhook =
  val r = request(w, requestId)
  val job = qualifiedJob(r.body)
  val scope = queueScope(job, RS::slopbotScope(registration))
  if (job == NoJob) updateRequest({ ...r, phase: AwaitCompletion,
    completion: if (r.valued) ValuationPending else Ignored }, w)
  else if (not(lookupOk)) releaseOrdinary(r, w)
  else if (scope == NoScope) updateRequest({ ...r, phase: AwaitCompletion, completion: NotRegistered }, w)
  else updateRequest({ ...r, scope: scope, completion: Queued, phase: if (job == HumanReopen) PersistReopen else SendQueue }, w)
```

## Story: Recover an uncertain queue submission without changing source authority

### An accepted reopen pins exact source before sending

The native adapter validates and records only safe metadata. A pull request
reopen binds its exact head SHA. An issue reopen binds the SHA-256 of the
normalized title/body join. The adapter validates the event timestamp and
node identity and discards the original source text. A changed reopen under
the same delivery ID refuses. An unavailable source completes with no
decision. A queue attempt may fail before storage or succeed while its
acknowledgment is lost. An error releases an ordinary receipt unless a
reopen source was retained. The separate valuation request survives either
failure. An unexpected error thrown while a claimed ordinary request is
valued, looked up, bound, sent or completed releases through the same path
before the error propagates (the `catch` around ordinary routing in
`workers/slopbot/index.ts`). An installation request, and a request not yet
claimed, never releases: the release sits only around ordinary routing. A
successful send enters final receipt completion. A completion failure is
recoverable through the same ordinary release path. Completion
does not establish exactly-once queue delivery. An overlapping ordinary
request can release the row before another completes, and the latter
source's completion update can affect zero rows. The adapter still returns
the response determined by that request.

```quint
pure def validReopen(s: ReopenSource): bool = s.installation > 0 and s.repository > 0 and s.number > 0
  and s.sender > 0 and s.node != "" and s.revision != "" and s.occurred > 0
pure def canBindReopen(w: Webhook, requestId: int): bool = request(w, requestId).phase == PersistReopen
pure def bindReopen(w: Webhook, requestId: int, strictSource: bool): Webhook =
  val r = request(w, requestId)
  val source = r.body.reopen
  if (not(strictSource) or not(validReopen(source))) updateRequest({ ...r, phase: AwaitCompletion, completion: ReopenUnavailable }, w)
  else if (not(w.exists) or (w.reopen != noReopen and w.reopen != source)) releaseOrdinary(r, w)
  else updateRequest({ ...r, phase: SendQueue }, { ...w, reopen: source })
pure def canSend(w: Webhook, requestId: int): bool = request(w, requestId).phase == SendQueue
pure def send(w: Webhook, requestId: int, ack: Ack): Webhook =
  val r = request(w, requestId)
  val sent = { ...w, sends: w.sends + (if (ack == QueueRejected) 0 else 1) }
  if (ack == QueuedAndAcked) updateRequest({ ...r, phase: AwaitCompletion }, sent)
  else releaseOrdinary(r, sent)
pure def canComplete(w: Webhook, requestId: int): bool = request(w, requestId).phase == AwaitCompletion
pure def complete(w: Webhook, requestId: int, committed: bool): Webhook =
  val r = request(w, requestId)
  if (committed) answer(r, 202, r.completion,
    if (w.exists) { ...w, receipt: ProcessedReceipt } else w)
  else releaseOrdinary(r, w)
pure def routingPhase(p: Ingress): bool =
  p == InspectValue or p == InspectQueue or p == PersistReopen or p == SendQueue or p == AwaitCompletion
pure def canFailRouting(w: Webhook, requestId: int): bool = routingPhase(request(w, requestId).phase)
pure def failRouting(w: Webhook, requestId: int): Webhook = releaseOrdinary(request(w, requestId), w)
```

### A downstream reopen decision rechecks the exact retained source

A recorded source alone is not a maintainer decision. The consumer checks
that job and retained source identities agree, the same GitHub node is
current, and its state is open or a close it may reconcile. An author reopen
is only an appeal for the exact currently reopened revision. A verified
maintainer decision names the event's original revision, even after a push.
Reversal-only processing needs an existing debit. Confirmation remains
idempotent and separate from cleanup, GitHub changes and Points reversals.

```quint
pure def reopenDecision(evidence: ReopenObservation, w: Webhook): ReopenDecision =
  val source = w.reopen
  val usable = source != noReopen and source == evidence.source and source.node == evidence.node
    and evidence.itemState != ClosedByOther and (not(evidence.reversalOnly) or evidence.existingDebit)
  if (not(usable)) NoDecision
  else if (source.sender == evidence.author) if (source.revision == evidence.currentRevision) AuthorAppeal else NoDecision
  else if (evidence.maintainer) MaintainerDecision else NoDecision
pure def canConfirmReopen(w: Webhook, evidence: ReopenObservation): bool =
  not(w.confirmed) and reopenDecision(evidence, w) == MaintainerDecision
pure def confirmReopen(w: Webhook, evidence: ReopenObservation): Webhook = { ...w, confirmed: true }
pure def alwaysConfirmedSource(w: Webhook): bool = w.confirmed implies w.reopen != noReopen
pure def alwaysReopenHasReceipt(w: Webhook): bool = w.reopen != noReopen implies w.exists
pure def alwaysValueRequestHasReceipt(w: Webhook): bool = w.value != noValue implies w.exists
pure def sometimesValuedReceiptKeptAfterFailure(w: Webhook): bool =
  w.value != noValue and w.reopen == noReopen and w.receipt == PendingReceipt
    and w.requests.some(r => r.result == Failed)
pure def stepValueSourceImmutable(before: Webhook, after: Webhook): bool = before.value != noValue implies after.value == before.value
pure def stepReopenSourceImmutable(before: Webhook, after: Webhook): bool = before.reopen != noReopen implies after.reopen == before.reopen
pure def sometimesValued(w: Webhook): bool = w.value != noValue
pure def sometimesReleased(w: Webhook): bool = w.sends > 0 and not(w.exists)
pure def sometimesReopenRetained(w: Webhook): bool = w.reopen != noReopen and w.sends > 0 and w.receipt == PendingReceipt
pure def sometimesConfirmed(w: Webhook): bool = w.confirmed
pure val sourceValue: ValueSource = { installation: 1, repository: 1, owner: "owner", repo: "repo", pull: 1 }
pure val sourceReopen: ReopenSource = { installation: 1, repository: 1, kind: PullItem, number: 1,
  sender: 2, node: "node", revision: "head", occurred: 1 }
pure val reviewBody: Body = { ...noBody, event: PullRequest, deliveryId: "delivery", publicRepo: true, job: Review }
pure val valueBody: Body = { ...reviewBody, valueCandidate: true, value: sourceValue, job: NoJob }
pure val reopenBody: Body = { ...reviewBody, job: HumanReopen, valueCandidate: true, value: sourceValue, reopen: sourceReopen }
pure val createdChange: I::InstallEvent = { delivery: 1, kind: I::Created, sourceTime: 1, hasAccount: true, validTime: true }
pure val bodyValues = Set(reviewBody, valueBody, reopenBody,
  { ...reviewBody, event: Installation, job: NoJob, change: createdChange },
  { ...reviewBody, event: Installation, job: NoJob, change: { ...createdChange, kind: I::Suspend, validTime: false } })
pure val evidenceValues = Set({source: sourceReopen, node: "node", currentRevision: "next", author: 1,
  itemState: OpenItem, maintainer: true, existingDebit: true, reversalOnly: false})
pure val requestIdValues = Set(1, 2)
pure val bodyBytes: Bytes = { digest: "body", length: 26214400 }
pure val bytesValues = Set(bodyBytes, { digest: "body", length: 26214401 })
pure val signedBytesValues = Set(bodyBytes, { digest: "altered", length: 26214400 })
pure val decodedBytesValues = signedBytesValues
pure val activeRegistry: RS::RegistryObservation = { lookup: RS::CurrentPath, registeredId: 1, observedId: 1,
  rowActive: true, manifestActive: true, retirement: RS::NotRetired, restriction: RS::Clear, flags: RS::NotFlagged }
pure val registrationValues = Set(activeRegistry, { ...activeRegistry, rowActive: false },
  { ...activeRegistry, retirement: RS::OwnerRetired })
pure val writeRegistrationValues = Set(activeRegistry, { ...activeRegistry, observedId: 2 })
pure val committedValues = Set(true, false)
pure def alwaysInstallationFlagMatchesChange(w: Webhook): bool =
  w.installationProcessed implies (w.firstEvent == Installation and w.install.processed.includes(w.installDelivery)
    and w.installDelivery > 0)
pure val weight_receive = 4
pure val weight_authenticate = 4
pure val weight_decode = 4
pure val weight_claim = 4
pure val weight_inspectValue = 4
pure val weight_inspectQueue = 4
pure val weight_bindReopen = 4
pure val weight_send = 4
```

The model does not validate live D1 races, WebCrypto or GitHub receipt
truth. The [job queue](./jobQueue.md) models duplicate copies, retries and
dead letters after a send. Strict object parsing protects the durable
boundary. The exact nested-payload normalization remains adapter
conformance. Which actor may issue which `/slopbot` command belongs to the
appeal and dispute rules, which recheck the sender on consumption.

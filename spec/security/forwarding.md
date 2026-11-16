# Reporter-authorized private GitHub forwarding

PRD sections 8 and 10. The [Slop intake](./intake.md) owns the original case
and receipt. The [screening model](./screening.md) owns approval of the
current retained report. Forwarding owns the optional GitHub delivery journal
for that submission, starting from a durable Slop case. The case and its
original receipt remain available through every forwarding outcome. An
existing legacy direct report uses the same GitHub receipt identity checks
with the direct-origin rules below.

Source at main `78eed5564d796119d82ae541c36b0c770263dc5f` is
`backend/security/submissions.ts:746–1095`, `backend/security/submission-store.ts:129–277`,
`backend/security/intake-grant.ts:271–331` and
`backend/security/github-advisories.ts:462–615`. These inputs contain private
identifiers only. The shell never supplies or exposes report text, sealed
cookies, the underlying marker string, access tokens or provider payloads as
model state. No installation credential sends an advisory. The shell uses
its verified GitHub parser, a private audited read, and transactional storage
for the external effects governed by these rules.

## Story: Forward the approved saved report using the researcher's consent

### Each request uses its own exact row revision and a reporter-only v1 grant

The current authenticated reporter and a verified sealed v1 cookie bind the
request to this submission and its Slop session. An expired, wrong-session,
wrong-account, wrong-submission or installation grant cannot authorize a
send, marker listing or advisory read. This is independent of the D1 row
revision. Inline operations in one request reuse its captured reporter grant.
The adapter supplies the expiry comparison from the request's clock in whole
seconds. A confirmed closed submission clears the cookie in the response.

```quint
import screening as S from "./screening"
import reportingReadiness as R from "./reportingReadiness"
type ForwardingPhase = Draft | Submitting | Uncertain | Submitted | ReceiptVerified | Failed
type Failure = None | Retryable | Terminal | AlreadyRecorded | Unverifiable | ReceiptMismatch
type Operation = SendReport | ListCopies | ReadAdvisory
type Credential = ReporterUser | Installation | OtherCredential
type Grant = { version: int, credential: Credential, authenticated: bool, sealed: bool,
  submission: int, reporter: int, session: int, expiresAtSeconds: int }
type Request = { id: int, revision: int, actor: int, session: int, checkedAtSeconds: int, grant: Grant }
type SendClaim = { revision: int, requestId: int, attempt: int, atMs: int, reportVersion: int, digest: str }
type ClaimRead = { requestId: int, changedOne: bool, rowPresent: bool, observedRevision: int, observedPhase: ForwardingPhase }
type SendGate = { seenScreeningRevision: int, reportVersion: int, digest: str, screening: S::Screening,
  bytesVerified: bool, intakeCurrent: bool, reportingReady: bool, allowedToParticipate: bool, wonClaim: bool }
type Copy = { ghsa: int, repository: int, author: int, marker: int, createdAtMs: int, digest: str }
type Forwarding = { phase: ForwardingPhase, failure: Failure, submission: int, reporter: int, repository: int, marker: int,
  caseId: int, revision: int, attempt: int, firstAtMs: int, activeClaim: SendClaim, readyClaims: List[SendClaim],
  postedRevisions: Set[int], canonical: Copy, duplicateGhsas: List[int], contactsPending: bool,
  receiptDigest: str, receiptReplyLost: bool, retryWithoutCopy: bool }
pure val noClaim: SendClaim = { revision: 0, requestId: 0, attempt: 0, atMs: 0, reportVersion: 0, digest: "" }
pure val noCopy: Copy = { ghsa: 0, repository: 0, author: 0, marker: 0, createdAtMs: 0, digest: "" }
pure val initial: Forwarding = { phase: Draft, failure: None, submission: 1, reporter: 1, repository: 1, marker: 1,
  caseId: 1, revision: 1, attempt: 0, firstAtMs: 0, activeClaim: noClaim, readyClaims: List(), postedRevisions: Set(),
  canonical: noCopy, duplicateGhsas: List(), contactsPending: false, receiptDigest: "", receiptReplyLost: false, retryWithoutCopy: false }
pure def grantAllows(f: Forwarding, request: Request): bool = request.id > 0 and request.actor == f.reporter
  and request.session > 0 and request.checkedAtSeconds >= 0 and request.grant.authenticated and request.grant.sealed
  and request.grant.version == 1 and request.grant.credential == ReporterUser and request.grant.submission == f.submission
  and request.grant.reporter == f.reporter and request.grant.session == request.session
  and request.grant.expiresAtSeconds > request.checkedAtSeconds
pure def currentRequest(f: Forwarding, request: Request): bool = request.revision == f.revision and grantAllows(f, request)
pure def mayOperate(f: Forwarding, request: Request, operation: Operation): bool = currentRequest(f, request) and
  (if (operation == SendReport) f.canonical.ghsa == 0 and (f.phase == Draft or (f.phase == Failed and f.failure == Retryable))
    else if (operation == ListCopies) f.phase == Uncertain and f.canonical.ghsa == 0
    else (f.phase == Submitted or (f.phase == Failed and f.failure == ReceiptMismatch)) and f.canonical.ghsa > 0)
pure def lawNoInstallationUse(f: Forwarding, request: Request, operation: Operation): bool =
  request.grant.credential == Installation implies not(mayOperate(f, request, operation))
```

### The atomic claim and exact readback precede any GitHub POST

A saved report uses its exact retained bytes. The atomic row transition
rechecks the reporter's participation and the approved intake revision.
`reportingReady` is the cached [reporting readiness](./reportingReadiness.md)
of the registered project revision and repository at the check
(`withReadiness`): fresh, enabled and verified for the same repository
identity. A stale, failed, disabled or mismatched observation refuses the send.
A duplicate caller receives the recorded result through the existing replay
lookup. A missing change count, a lost commit response or a missing/changed
readback cannot lend a send claim. The external call has no lease against
later D1 updates. A request that already read back its own claim may start
late, but its response cannot write a different current claim.

```quint
pure def withReadiness(gate: SendGate, cache: R::Readiness, target: R::Target, checkedAtMs: int): SendGate =
  { ...gate, reportingReady: R::readyFor(cache, target, checkedAtMs) }
pure def gateMatches(gate: SendGate): bool = gate.wonClaim and gate.bytesVerified and gate.intakeCurrent and gate.reportingReady
  and gate.allowedToParticipate and gate.seenScreeningRevision == gate.screening.revision
  and gate.reportVersion > 0 and gate.reportVersion == gate.screening.version and gate.digest != ""
  and gate.digest == gate.screening.digest and S::qualified(gate.screening)
pure def canClaimSend(f: Forwarding, request: Request, gate: SendGate, startedAtMs: int): bool = mayOperate(f, request, SendReport)
  and gateMatches(gate) and startedAtMs > 0 and startedAtMs >= f.activeClaim.atMs
pure def lawUnreadyCacheRefusesSend(f: Forwarding, request: Request, gate: SendGate, cache: R::Readiness, target: R::Target,
  checkedAtMs: int, startedAtMs: int): bool =
  not(R::readyFor(cache, target, checkedAtMs)) implies not(canClaimSend(f, request, withReadiness(gate, cache, target, checkedAtMs), startedAtMs))
pure def claimSend(f: Forwarding, request: Request, gate: SendGate, startedAtMs: int): Forwarding =
  { ...f, phase: Submitting, failure: None, revision: f.revision + 1, attempt: f.attempt + 1,
    firstAtMs: if (f.attempt == 0) startedAtMs else f.firstAtMs, retryWithoutCopy: false,
    activeClaim: { revision: f.revision + 1, requestId: request.id, attempt: f.attempt + 1, atMs: startedAtMs, reportVersion: gate.reportVersion, digest: gate.digest } }
pure def canRecordClaimRead(f: Forwarding, readback: ClaimRead): bool = f.phase == Submitting and readback.changedOne and readback.rowPresent
  and readback.observedRevision == f.revision and readback.observedPhase == Submitting
  and f.activeClaim.revision == readback.observedRevision and f.activeClaim.requestId == readback.requestId
  and not(f.readyClaims.includes(f.activeClaim))
pure def recordClaimRead(f: Forwarding, readback: ClaimRead): Forwarding = { ...f, readyClaims: f.readyClaims.append(f.activeClaim) }
pure def canStartPost(f: Forwarding, claim: SendClaim): bool = claim.revision > 0 and f.readyClaims.includes(claim) and not(f.postedRevisions.contains(claim.revision))
pure def startPost(f: Forwarding, claim: SendClaim): Forwarding = { ...f, postedRevisions: f.postedRevisions.union(Set(claim.revision)) }
pure def ownsPostedClaim(f: Forwarding, claim: SendClaim): bool = f.phase == Submitting and f.revision == claim.revision
  and f.activeClaim == claim and f.postedRevisions.contains(claim.revision)
pure def canMarkInterrupted(f: Forwarding, nowMs: int): bool = f.phase == Submitting and nowMs - f.activeClaim.atMs > 60000
pure def markInterrupted(f: Forwarding, nowMs: int): Forwarding = { ...f, phase: Uncertain, revision: f.revision + 1 }
pure def alwaysClaimBound(f: Forwarding): bool = f.attempt >= 0 and
  (f.phase == Submitting implies f.activeClaim.revision == f.revision and f.activeClaim.attempt == f.attempt
    and f.attempt > 0 and f.activeClaim.atMs > 0)
pure def stepEarlierClaimsRetained(before: Forwarding, after: Forwarding): bool = before.readyClaims.every(claim => after.readyClaims.includes(claim))
pure def lawClaimReadbackUsesOwnRevision(f: Forwarding, readback: ClaimRead): bool =
  canRecordClaimRead(f, readback) implies readback.observedRevision == f.activeClaim.revision and readback.requestId == f.activeClaim.requestId
pure def stepPostNeedsOwnReadback(before: Forwarding, after: Forwarding): bool =
  after.postedRevisions.forall(revision => before.postedRevisions.contains(revision) or before.readyClaims.some(claim => claim.revision == revision))
```

### Only recognized throttling reopens the same draft without a listing

The GitHub adapter recognizes 429 and the explicit 403 primary or secondary
rate-limit evidence. Those responses confirm this attempt created no copy and
may include a bounded retry-after. The retry-after hint is bounded by one hour. Other exact refusals retain
their failure class. Lost, malformed or otherwise unresolved responses stay uncertain and
cannot be resent directly. A late accepted response that loses its compare
and set is reconciled. The legacy fallback may move a still-submitting current
row to uncertain via a separate fresh exact read. It never starts a second POST.

```quint
type PostResult = CopyUnknown | ThrottledNoCopy | DefiniteRetryable | DefiniteTerminal
pure def canRecordPostResult(f: Forwarding, claim: SendClaim): bool = ownsPostedClaim(f, claim)
pure def recordPostResult(f: Forwarding, claim: SendClaim, result: PostResult): Forwarding =
  { ...f, revision: f.revision + 1, retryWithoutCopy: result == ThrottledNoCopy,
    phase: if (result == ThrottledNoCopy) Draft else if (result == CopyUnknown) Uncertain else Failed,
    failure: if (result == DefiniteTerminal) Terminal else if (result == DefiniteRetryable) Retryable else None }
pure def canHoldLateCopy(f: Forwarding, claim: SendClaim, seenRevision: int, accepted: Copy): bool = f.phase == Submitting
  and seenRevision == f.revision and claim.revision != f.revision and f.readyClaims.includes(claim)
  and f.postedRevisions.contains(claim.revision) and validCreatedCopy(f, accepted)
pure def holdLateCopy(f: Forwarding, claim: SendClaim, seenRevision: int, accepted: Copy): Forwarding = { ...f, phase: Uncertain, revision: f.revision + 1 }
pure def sometimesRetryableDraft(f: Forwarding): bool = f.phase == Draft and f.retryWithoutCopy
pure def sometimesUncertain(f: Forwarding): bool = f.phase == Uncertain
```

## Story: Reconcile the exact privately submitted copy and verify its receipt

### A complete matching listing chooses the earliest copy or permits retry after the quiet window

The listing begins ten minutes before the first durable send and matches the
exact repository, reporter and submission marker. The read adapter admits only
a bounded parsed list of up to ten pages with every admissible continuation
followed to its end or to the proven lower bound. Missing pages, refused
continuations, read errors and malformed rows are inconclusive. An empty
complete listing before five minutes since the latest claim keeps the request
uncertain. At five minutes or later it reopens a draft without asserting that
a delayed copy can never become visible.

A qualified positive observation chooses the earliest observed creation time,
then the lowest canonical GHSA lexical rank on a tie. The adapter maps parsed
GHSA identifiers to a lossless order-preserving positive number and reduces
creation timestamps to UTC milliseconds. A resend that succeeds includes its
accepted copy in this comparison. If that optional listing fails, keep the
accepted copy. Residual observed copies are private duplicate evidence. Their list preserves
identity; list order has no meaning. Once
a canonical GHSA is bound, no later observation can replace it.

```quint
type Listing = { complete: bool, submission: int, repository: int, marker: int, sinceMs: int, copies: List[Copy] }
pure def validCreatedCopy(f: Forwarding, copy: Copy): bool = copy.ghsa > 0 and copy.repository == f.repository
  and copy.author == f.reporter and copy.createdAtMs > 0 and copy.digest != ""
pure def exactListing(f: Forwarding, listing: Listing): bool = listing.complete and listing.submission == f.submission
  and listing.repository == f.repository and listing.marker == f.marker and listing.sinceMs == f.firstAtMs - 600000
  and listing.copies.every(copy => validCreatedCopy(f, copy) and copy.marker == f.marker and copy.createdAtMs >= listing.sinceMs)
pure def comesBefore(candidate: Copy, incumbent: Copy): bool = incumbent.ghsa == 0 or candidate.createdAtMs < incumbent.createdAtMs
  or (candidate.createdAtMs == incumbent.createdAtMs and candidate.ghsa < incumbent.ghsa)
pure def earliestCopy(copies: List[Copy], accepted: Copy): Copy = copies.foldl(accepted,
  (incumbent, candidate) => if (comesBefore(candidate, incumbent)) candidate else incumbent)
pure def createdCandidates(f: Forwarding, accepted: Copy, listing: Listing): List[Copy] =
  if (f.attempt > 1 and exactListing(f, listing)) listing.copies.select(copy => copy.ghsa != accepted.ghsa) else List()
pure def canRecordCreated(f: Forwarding, claim: SendClaim, accepted: Copy, listing: Listing): bool =
  ownsPostedClaim(f, claim) and validCreatedCopy(f, accepted)
pure def recordCreated(f: Forwarding, claim: SendClaim, accepted: Copy, listing: Listing): Forwarding =
  val copies = createdCandidates(f, accepted, listing)
  val chosen = earliestCopy(copies, accepted)
  { ...f, phase: Submitted, revision: f.revision + 1, canonical: chosen,
    duplicateGhsas: copies.append(accepted).select(copy => copy.ghsa != chosen.ghsa).listMap(copy => copy.ghsa) }
pure def canReconcile(f: Forwarding, request: Request, listing: Listing, nowMs: int): bool = mayOperate(f, request, ListCopies) and nowMs > 0
pure def reconcile(f: Forwarding, request: Request, listing: Listing, nowMs: int): Forwarding =
  val observed = exactListing(f, listing)
  val chosen = earliestCopy(listing.copies, noCopy)
  if (observed and chosen.ghsa > 0)
    { ...f, phase: Submitted, revision: f.revision + 1, canonical: chosen,
      duplicateGhsas: listing.copies.select(copy => copy.ghsa != chosen.ghsa).listMap(copy => copy.ghsa) }
  else if (observed and listing.copies.length() == 0 and nowMs - f.activeClaim.atMs >= 300000)
    { ...f, phase: Draft, revision: f.revision + 1, retryWithoutCopy: true }
  else { ...f, revision: f.revision + 1 }
pure def lawUnknownListingCannotReopen(f: Forwarding, request: Request, listing: Listing, nowMs: int): bool =
  canReconcile(f, request, listing, nowMs) and not(exactListing(f, listing)) implies reconcile(f, request, listing, nowMs).phase == Uncertain
pure def lawEarlyEmptyCannotReopen(f: Forwarding, request: Request, listing: Listing, nowMs: int): bool =
  canReconcile(f, request, listing, nowMs) and listing.copies.length() == 0 and nowMs - f.activeClaim.atMs < 300000
    implies reconcile(f, request, listing, nowMs).phase == Uncertain
pure def stepCanonicalFixed(before: Forwarding, after: Forwarding): bool = before.canonical.ghsa > 0 implies after.canonical == before.canonical
pure def sometimesSubmitted(f: Forwarding): bool = f.phase == Submitted
pure def sometimesDuplicates(f: Forwarding): bool = f.duplicateGhsas.length() > 0
```

### A separate exact advisory read links one verified receipt to the saved case

Re-read the bound GHSA with valid reporter consent and separately check exact
current intake repository, immutable author, submission marker and creation
time. The allowed GitHub clock skew is five minutes. An advisory read error
or 404 in this forwarded path keeps the canonical copy and stays submitted.
The direct-origin adapter requires a live private vulnerability report in
triage, draft or published state and treats 404 as a failed verification.
Editable reporter credits and pasted links cannot establish authorship.

A matching advisory with no current technical contacts stays recoverable,
and a later verified linkage clears that pending contact state. A read whose
repository, marker or creation time does not match keeps the canonical copy
and permits another exact read with fresh consent; it never permits a resend.
An author mismatch is terminal. Only a legacy GitHub-first draft or failure
with no saved Slop report and no GitHub copy is abandoned (D1 `abandoned`)
after 24 idle hours; a saved Slop report never is.
Otherwise the compare-and-set links only the retained case, with an exact
verified receipt digest. An unrelated case already holding the advisory
refuses linkage without disclosing that case. A lost durable receipt response
cannot remove the linkage or justify resending the report.

```quint
type ReadStatus = Found | NotFound | ReadError
type GitHubState = Triage | AdvisoryDraft | Published | OtherAdvisoryState
type AdvisoryRead = { status: ReadStatus, facts: Copy, currentRepository: int, checkedAtMs: int,
  currentContacts: bool, competingCase: bool, writeCommitted: bool, privateReport: bool, githubState: GitHubState }
pure def receiptIdentityMatches(f: Forwarding, advisoryRead: AdvisoryRead): bool = advisoryRead.status == Found
  and validCreatedCopy(f, advisoryRead.facts) and advisoryRead.facts.ghsa == f.canonical.ghsa
  and advisoryRead.currentRepository == f.repository and advisoryRead.facts.marker == f.marker
  and advisoryRead.facts.createdAtMs <= advisoryRead.checkedAtMs + 300000
type DirectCheck = DirectReceipt | DirectMissing | DirectInconclusive | DirectInvalid | DirectWrongAuthor | DirectNotPrivate
type DirectRequest = { ghsa: int, repository: int, reporter: int }
pure def directReceiptCheck(direct: DirectRequest, advisoryRead: AdvisoryRead): DirectCheck =
  if (advisoryRead.status == ReadError) DirectInconclusive
  else if (advisoryRead.status == NotFound) DirectMissing
  else if (direct.ghsa <= 0 or advisoryRead.facts.ghsa != direct.ghsa or advisoryRead.facts.repository != direct.repository
    or advisoryRead.currentRepository != direct.repository) DirectInvalid
  else if (advisoryRead.facts.author != direct.reporter) DirectWrongAuthor
  else if (not(advisoryRead.privateReport) or (advisoryRead.githubState != Triage and advisoryRead.githubState != AdvisoryDraft
    and advisoryRead.githubState != Published)) DirectNotPrivate
  else if (advisoryRead.facts.createdAtMs <= 0 or advisoryRead.facts.createdAtMs > advisoryRead.checkedAtMs + 300000
    or advisoryRead.facts.digest == "") DirectInvalid
  else DirectReceipt
pure def canReadReceipt(f: Forwarding, request: Request, advisoryRead: AdvisoryRead): bool = mayOperate(f, request, ReadAdvisory)
pure def readReceipt(f: Forwarding, request: Request, advisoryRead: AdvisoryRead): Forwarding =
  if (advisoryRead.status != Found) { ...f, revision: f.revision + 1 }
  else if (not(receiptIdentityMatches(f, advisoryRead))) { ...f, revision: f.revision + 1, phase: Failed,
    failure: if (advisoryRead.facts.author != f.reporter) Terminal else ReceiptMismatch }
  else if (not(advisoryRead.currentContacts)) { ...f, revision: f.revision + 1, contactsPending: true }
  else if (advisoryRead.competingCase) { ...f, revision: f.revision + 1, phase: Failed, failure: AlreadyRecorded }
  else if (advisoryRead.writeCommitted) { ...f, revision: f.revision + 1, phase: ReceiptVerified, receiptDigest: advisoryRead.facts.digest, contactsPending: false }
  else f
pure def mayAbandon(f: Forwarding, idleMs: int, savedReport: bool): bool = not(savedReport) and idleMs > 86400000
  and f.canonical.ghsa == 0 and (f.phase == Draft or (f.phase == Failed and f.failure != Unverifiable))
pure def lawSavedReportNeverAbandoned(f: Forwarding, idleMs: int): bool = not(mayAbandon(f, idleMs, true))
pure def lawCopyNeverAbandoned(f: Forwarding, idleMs: int, savedReport: bool): bool = f.canonical.ghsa > 0 implies not(mayAbandon(f, idleMs, savedReport))
pure def canExpireVerification(f: Forwarding, nowMs: int): bool = f.phase == Submitted and not(f.contactsPending) and nowMs - f.activeClaim.atMs > 86400000
pure def expireVerification(f: Forwarding, nowMs: int): Forwarding = { ...f, revision: f.revision + 1, phase: Failed, failure: Unverifiable }
pure def canLoseReceiptReply(f: Forwarding): bool = f.phase == ReceiptVerified and not(f.receiptReplyLost)
pure def loseReceiptReply(f: Forwarding): Forwarding = { ...f, receiptReplyLost: true }
pure def alwaysOriginalCase(f: Forwarding): bool = f.caseId == 1 and f.submission == 1 and f.reporter == 1 and f.repository == 1 and f.marker == 1
pure def alwaysReceiptBinding(f: Forwarding): bool = f.phase == ReceiptVerified implies f.canonical.ghsa > 0 and f.receiptDigest != ""
pure def alwaysSubmittedBinding(f: Forwarding): bool = f.phase == Submitted implies f.canonical.ghsa > 0
pure def alwaysDraftHasNoCopy(f: Forwarding): bool = (f.phase == Draft or f.phase == Submitting or f.phase == Uncertain) implies f.canonical.ghsa == 0
pure def sometimesContactsUnavailable(f: Forwarding): bool = f.phase == Submitted and f.contactsPending
pure def sometimesReceiptRecovered(f: Forwarding): bool = f.phase == ReceiptVerified and f.receiptReplyLost
```

### Simulation samples expose retry, stale ownership and exact receipt paths

```quint
pure val capturedGrant: Grant = { version: 1, credential: ReporterUser, authenticated: true, sealed: true,
  submission: 1, reporter: 1, session: 1, expiresAtSeconds: 7210 }
pure val revisionsToTry = Set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
pure val requestValues = revisionsToTry.fold(Set(), (requests, revision) => requests.union(Set(
  { id: 1, revision: revision, actor: 1, session: 1, checkedAtSeconds: 10, grant: capturedGrant },
  { id: 2, revision: revision, actor: 1, session: 1, checkedAtSeconds: 10, grant: capturedGrant })))
pure val readbackValues = revisionsToTry.fold(Set(), (reads, revision) => reads.union(Set(
  { requestId: 1, changedOne: true, rowPresent: true, observedRevision: revision, observedPhase: Submitting },
  { requestId: 2, changedOne: true, rowPresent: true, observedRevision: revision, observedPhase: Submitting })))
pure val approvedReport = { ...S::initial, phase: S::Legitimate }
pure val gateValues = Set({ seenScreeningRevision: 1, reportVersion: 1, digest: "original", screening: approvedReport,
  bytesVerified: true, intakeCurrent: true, reportingReady: true, allowedToParticipate: true, wonClaim: true },
  { seenScreeningRevision: 1, reportVersion: 1, digest: "original", screening: approvedReport,
  bytesVerified: true, intakeCurrent: true, reportingReady: false, allowedToParticipate: true, wonClaim: true })
pure val cacheValues = Set(R::initial, { observations: List({ revision: 1, repository: 1, repositoryId: 11, repositoryNodeId: 21,
  enabled: true, verifiedAt: 1000, attemptedAt: 1000, failure: R::NoFailure }) })
pure val checkedAtMsValues = Set(2000, 4000000)
pure val claimValues = revisionsToTry.fold(Set(), (claims, revision) => claims.union(Set(
  { revision: revision, requestId: 1, attempt: 1, atMs: 1000000, reportVersion: 1, digest: "original" },
  { revision: revision, requestId: 2, attempt: 1, atMs: 1000000, reportVersion: 1, digest: "original" },
  { revision: revision, requestId: 1, attempt: 2, atMs: 1000000, reportVersion: 1, digest: "original" },
  { revision: revision, requestId: 2, attempt: 2, atMs: 1000000, reportVersion: 1, digest: "original" })))
pure val startedAtMsValues = Set(1000000)
pure val seenRevisionValues = Set(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
pure val nowMsValues = Set(1000000, 1060000, 1060001, 1299999, 1300000, 87400001)
pure val earlyCopy: Copy = { ghsa: 2, repository: 1, author: 1, marker: 1, createdAtMs: 1010000, digest: "early" }
pure val lateCopy: Copy = { ghsa: 1, repository: 1, author: 1, marker: 1, createdAtMs: 1050000, digest: "late" }
pure val baseListing: Listing = { complete: true, submission: 1, repository: 1, marker: 1, sinceMs: 400000, copies: List() }
pure val listingValues = Set(baseListing, { ...baseListing, copies: List(lateCopy, earlyCopy) }, { ...baseListing, complete: false })
pure val acceptedValues = Set(lateCopy, earlyCopy)
pure val earlyReceipt: AdvisoryRead = { status: Found, facts: earlyCopy, currentRepository: 1, checkedAtMs: 1300000,
  currentContacts: true, competingCase: false, writeCommitted: true, privateReport: true, githubState: Triage }
pure val advisoryReadValues = Set(earlyReceipt, { ...earlyReceipt, currentContacts: false }, { ...earlyReceipt, facts: lateCopy },
  { ...earlyReceipt, status: NotFound }, { ...earlyReceipt, competingCase: true })
pure val weight_holdLateCopy = 45
pure val weight_claimSend = 22
pure val weight_recordClaimRead = 35
pure val weight_startPost = 60
pure val weight_recordPostResult = 70
pure val weight_recordCreated = 64
pure val weight_reconcile = 35
pure val weight_readReceipt = 50
pure val weight_loseReceiptReply = 60
```

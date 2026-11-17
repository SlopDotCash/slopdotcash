# Composed private report journey

PRD sections 8 and 10 bind the private report journey to the reporter's Inbox
receipt, the owners' case notices, the private report text, the exclusion
advice, the GitHub copy that forwarding binds and a legacy report filed on
GitHub first. This machine holds the [composed report
flow](./journey.md), the [Inbox](../operations/notifications.md), one legacy
direct-origin [case](./cases.md) and the retained report bodies, and supplies
every cross-machine fact from their state. The Inbox keeps its own
preparation, consent and provider reconciliation; the shell keeps report
text out of logs and analytics.

## Story: Receive the report with its Inbox receipt and route it to the owners

### The atomic receipt saves the reporter's Inbox receipt in the same step

The case, the intake receipt and the reporter's receipt notice commit
together under the intake's idempotency key, with the receipt template on
the security outbox. A replay of the same key and bytes returns the recorded
receipt and saves nothing new. Nothing is in the Inbox before the receipt. A
notice's key is its source change: the kind of change and its subject, so
two changes never share a key. Report receipts, owner routing and legacy
direct receipts use codes 1 to 3; award notices use codes 4 to 7 ([private
award settlement](../settlement/privateAward.md)).

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import program as P from "./program"
import intake as I from "./intake"
import screening as S from "./screening"
import cases as C from "./cases"
import assessment as A from "./assessment"
import forwarding as F from "./forwarding"
import journey as J from "./journey"
import notifications as N from "../operations/notifications"
import email as E from "../backend/email"
type SecretReportBody = str
type BodyDigest = { object: int, version: str }
type ReportNotices = { journey: J::Journey, inbox: N::Inbox, directCase: C::PrivateCase, directChecked: bool,
  directAdvisory: F::Copy, bodies: List[SecretReportBody] }
pure val initial: ReportNotices = { journey: J::initial, inbox: N::initial, directCase: C::initial, directChecked: false,
  directAdvisory: F::noCopy, bodies: List() }
pure def caseReporter(r: ReportNotices): int = r.journey.privateCase.reporter
type ReportNotice = ReportReceived | OwnersRouted | DirectReportReceived
pure def noticeCode(notice: ReportNotice): int = if (notice == ReportReceived) 1 else if (notice == OwnersRouted) 2 else 3
pure def noticeKey(notice: ReportNotice, id: int): int = 10 * id + noticeCode(notice)
pure def lawNoticeKeysDistinct(notice: ReportNotice, other: ReportNotice, id: int, otherId: int): bool =
  (notice != other or id != otherId) implies noticeKey(notice, id) != noticeKey(other, otherId)
pure def receiptKey(key: int): int = noticeKey(ReportReceived, key)
pure def receiptNoticeKey(r: ReportNotices): int = receiptKey(r.journey.intake.key)
pure def directNoticeKey(r: ReportNotices): int = noticeKey(DirectReportReceived, r.directAdvisory.ghsa)
pure def canCommitReceipt(r: ReportNotices, receivedAt: int): bool = J::canCommitReceipt(r.journey, receivedAt)
  and N::canSave(r.inbox, receiptNoticeKey(r), N::SecurityReportReceived, caseReporter(r))
pure def commitReceipt(r: ReportNotices, receivedAt: int): ReportNotices =
  { ...r, journey: J::commitReceipt(r.journey, receivedAt),
    inbox: N::save(r.inbox, receiptNoticeKey(r), N::SecurityReportReceived, caseReporter(r)) }
pure def canReconcileReceipt(r: ReportNotices, key: int, digest: int): bool = I::canReconcileReceipt(r.journey.intake, key, digest)
  and N::canSave(r.inbox, receiptKey(key), N::SecurityReportReceived, caseReporter(r))
pure def reconcileReceipt(r: ReportNotices, key: int, digest: int): ReportNotices =
  { ...r, journey: { ...r.journey, intake: I::reconcileReceipt(r.journey.intake, key, digest) },
    inbox: N::save(r.inbox, receiptKey(key), N::SecurityReportReceived, caseReporter(r)) }
pure def alwaysReceiptNoticeAtomic(r: ReportNotices): bool =
  (r.journey.intake.inboxExists iff N::noticeExists(r.inbox, receiptNoticeKey(r), caseReporter(r)))
  and (r.directChecked iff N::noticeExists(r.inbox, directNoticeKey(r), r.directCase.reporter))
  and r.inbox.notices.every(n => n.kind == N::SecurityReportReceived implies n.template == N::ReceiptTemplate
    and ((n.key == receiptNoticeKey(r) and n.recipient == caseReporter(r))
      or (r.directChecked and n.key == directNoticeKey(r) and n.recipient == r.directCase.reporter)))
pure def alwaysInboxChannels(r: ReportNotices): bool = N::alwaysChannelByKind(r.inbox) and N::alwaysNoticeIdentity(r.inbox)
pure def stepReceiptNoticeNeedsReceipt(before: ReportNotices, after: ReportNotices): bool =
  after.inbox.notices.every(n => before.inbox.notices.includes(n) or n.kind != N::SecurityReportReceived
    or (n.key == receiptNoticeKey(after) and J::received(after.journey))
    or (n.key == directNoticeKey(after) and after.directChecked and not(before.directChecked)))
pure def stepNoticesPermanent(before: ReportNotices, after: ReportNotices): bool = N::stepNoticesPermanent(before.inbox, after.inbox)
pure def sometimesReceiptQueued(r: ReportNotices): bool = J::received(r.journey)
  and r.inbox.notices.some(n => n.kind == N::SecurityReportReceived and n.state == N::Queued)
```

### Routing saves one private case notice per eligible technical recipient

Routing a qualified version saves, in the same step, one case notice under
that version for each current technical approver other than the reporter.
A notice records no report text or amount. Delivery to a verified
destination stays with the Inbox; the acting maintainer and missing contacts
stay with screening.

```quint
pure def routeKey(version: int): int = noticeKey(OwnersRouted, version)
pure def ownerRecipients(r: ReportNotices): List[int] =
  r.journey.privateCase.authority.technical.select(t => t != caseReporter(r))
pure def canObserveAuthority(r: ReportNotices, snapshot: C::Authority): bool = J::canObserveAuthority(r.journey, snapshot)
pure def observeAuthority(r: ReportNotices, snapshot: C::Authority): ReportNotices =
  { ...r, journey: J::observeAuthority(r.journey, snapshot) }
pure def canRoute(r: ReportNotices, seenRevision: int): bool = J::canRoute(r.journey, seenRevision)
  and ownerRecipients(r).every(t => N::canSave(r.inbox, routeKey(r.journey.screening.version), N::SecurityCase, t))
pure def route(r: ReportNotices, seenRevision: int): ReportNotices =
  { ...r, journey: J::route(r.journey, seenRevision),
    inbox: ownerRecipients(r).foldl(r.inbox, (inbox, t) => N::save(inbox, routeKey(r.journey.screening.version), N::SecurityCase, t)) }
pure def alwaysOwnerNoticeRouted(r: ReportNotices): bool = r.inbox.notices.every(n => n.kind == N::SecurityCase implies
  n.key % 10 == noticeCode(OwnersRouted) and r.journey.screening.noticeVersions.contains(n.key / 10) and n.recipient != caseReporter(r))
pure def stepOwnerNoticeNeedsQualification(before: ReportNotices, after: ReportNotices): bool =
  after.inbox.notices.every(n => before.inbox.notices.includes(n) or n.kind != N::SecurityCase
    or S::qualified(before.journey.screening))
pure def sometimesOwnersNotified(r: ReportNotices): bool = r.journey.screening.routed
  and r.inbox.notices.some(n => n.kind == N::SecurityCase)
```

### An intake outage keeps every received case and its receipt notice

Every step taken while intake is unavailable keeps the received intake
record, the case's receipt and the reporter's receipt notice.

```quint
pure def canObserveAvailability(r: ReportNotices, availability: I::IntakeAvailability): bool =
  I::canObserveAvailability(r.journey.intake, availability)
pure def observeAvailability(r: ReportNotices, availability: I::IntakeAvailability): ReportNotices =
  { ...r, journey: { ...r.journey, intake: I::observeAvailability(r.journey.intake, availability) } }
pure def sameReceipt(a: I::Intake, b: I::Intake): bool = a.phase == b.phase and a.key == b.key and a.digest == b.digest
  and a.receivedAt == b.receivedAt and a.terms == b.terms and a.caseExists == b.caseExists and a.inboxExists == b.inboxExists
pure def stepOutageKeepsCases(before: ReportNotices, after: ReportNotices): bool =
  (before.journey.intake.availability == I::Unavailable and J::received(before.journey)) implies
    sameReceipt(after.journey.intake, before.journey.intake)
    and after.journey.privateCase.submission == before.journey.privateCase.submission
    and after.journey.privateCase.terms == before.journey.privateCase.terms
    and N::noticeExists(after.inbox, receiptNoticeKey(after), caseReporter(after))
pure def sometimesOutageAfterReceipt(r: ReportNotices): bool = r.journey.intake.availability == I::Unavailable
  and J::received(r.journey) and N::noticeExists(r.inbox, receiptNoticeKey(r), caseReporter(r))
```

## Story: Keep the report text private

### Report bodies stay out of every record and never reach a public issue

A report body is held only in this machine's retained bodies. Its single way
out is the digest pair that names the stored object and the screening
version: the intake records the first body's object digest and screening's
history records each revised body's version digest, never the text. The first
version is bound only through its object digest; screening names it
"original". No
Inbox notice, screening, forwarding or case field and no transition result
carries a body. No machine has a public-issue operation: forwarding's only
GitHub operations send the private report, list copies and read the advisory,
each with the reporter's own grant.

```quint
const digestOf: (SecretReportBody) => BodyDigest
pure def lawDigestNamesStoredBytes(b: SecretReportBody): bool = digestOf(b).object > 0 and digestOf(b).version != ""
  and digestOf(b).version != "original"
pure def declassifyDigest(b: SecretReportBody): BodyDigest = digestOf(b)
pure def canBegin(r: ReportNotices, key: int, body: SecretReportBody, reporter: int, repository: int, projectRevision: int, nowMs: int): bool =
  J::canBegin(r.journey, key, declassifyDigest(body).object, reporter, repository, projectRevision, nowMs)
    and reporter == r.journey.forwarding.reporter and repository == r.journey.forwarding.repository
pure def begin(r: ReportNotices, key: int, body: SecretReportBody, reporter: int, repository: int, projectRevision: int, nowMs: int): ReportNotices =
  { ...r, journey: J::begin(r.journey, key, declassifyDigest(body).object, reporter, repository, projectRevision, nowMs),
    bodies: r.bodies.append(body) }
pure def canVerifyObject(r: ReportNotices, digest: int): bool = J::canVerifyObject(r.journey, digest)
pure def verifyObject(r: ReportNotices, digest: int): ReportNotices = { ...r, journey: J::verifyObject(r.journey, digest) }
pure def canReplace(r: ReportNotices, by: int, seenRevision: int, body: SecretReportBody, nowMs: int): bool =
  J::canReplace(r.journey, by, seenRevision, declassifyDigest(body).version, nowMs)
pure def replace(r: ReportNotices, by: int, seenRevision: int, body: SecretReportBody, nowMs: int): ReportNotices =
  { ...r, journey: J::replace(r.journey, by, seenRevision, declassifyDigest(body).version, nowMs), bodies: r.bodies.append(body) }
pure def alwaysBodiesMatchVersions(r: ReportNotices): bool =
  r.bodies.length() == (if (r.journey.intake.phase == I::Editing) 0 else r.journey.screening.version)
  and (r.journey.intake.phase == I::Editing implies r.journey.screening.version == 1)
pure def alwaysBodiesBoundToRecords(r: ReportNotices): bool =
  (r.bodies.length() > 0 implies digestOf(r.bodies.nthOr(0, "")).object == r.journey.intake.digest)
  and r.bodies.every(body => body == r.bodies.nthOr(0, "") or r.journey.screening.reportDigests.includes(digestOf(body).version))
pure def sometimesRevisedBodyRetained(r: ReportNotices): bool = r.bodies.length() > 1
```

## Story: Exclusions inform advice without deciding

### The receipt-time exclusion context reaches screening, assessment and appeal triage

[Screening](./screening.md), the [assessment](./assessment.md) and appeal
[triage](./cases.md) each record the exclusion context they ran with and the
line they named; the [composed flow](./journey.md) binds that context to the
case's receipt-time [terms](./terms.md), and no decision reads it.

```quint
pure def canClaimScreening(r: ReportNotices, seenRevision: int, nowMs: int): bool = J::canClaimScreening(r.journey, seenRevision, nowMs)
pure def claimScreening(r: ReportNotices, seenRevision: int, nowMs: int): ReportNotices =
  { ...r, journey: J::claimScreening(r.journey, seenRevision, nowMs) }
pure def canFinishScreening(r: ReportNotices, token: S::Claim, input: S::Input, observation: S::Observation): bool =
  J::canFinishScreening(r.journey, token, input, observation)
pure def finishScreening(r: ReportNotices, token: S::Claim, input: S::Input, observation: S::Observation): ReportNotices =
  { ...r, journey: J::finishScreening(r.journey, token, input, observation) }
pure def canObserveQualified(r: ReportNotices): bool = J::canObserveQualified(r.journey)
pure def observeQualified(r: ReportNotices): ReportNotices = { ...r, journey: J::observeQualified(r.journey) }
pure def canStartAssessment(r: ReportNotices, nowMs: int): bool = J::canStartAssessment(r.journey, nowMs)
pure def startAssessment(r: ReportNotices, nowMs: int): ReportNotices = { ...r, journey: J::startAssessment(r.journey, nowMs) }
pure def canFinishAssessment(r: ReportNotices, attempt: int, complete: bool, elapsedMs: int): bool =
  J::canFinishAssessment(r.journey, attempt, complete, elapsedMs)
pure def finishAssessment(r: ReportNotices, attempt: int, complete: bool, elapsedMs: int): ReportNotices =
  { ...r, journey: J::finishAssessment(r.journey, attempt, complete, elapsedMs) }
pure def canDecide(r: ReportNotices, by: int, checkedEpoch: int, decision: C::Decision): bool = J::canDecide(r.journey, by, checkedEpoch, decision)
pure def decide(r: ReportNotices, by: int, checkedEpoch: int, decision: C::Decision): ReportNotices =
  { ...r, journey: J::decide(r.journey, by, checkedEpoch, decision) }
pure def canAppeal(r: ReportNotices, by: int): bool = C::canAppeal(r.journey.privateCase, by)
pure def appeal(r: ReportNotices, by: int): ReportNotices =
  { ...r, journey: { ...r.journey, privateCase: C::appeal(r.journey.privateCase, by) } }
pure def canStartTriage(r: ReportNotices, nowMs: int): bool = C::canStartTriage(r.journey.privateCase, nowMs)
pure def startTriage(r: ReportNotices, nowMs: int): ReportNotices =
  { ...r, journey: { ...r.journey, privateCase: C::startTriage(r.journey.privateCase, nowMs) } }
pure def canFinishTriage(r: ReportNotices, appealRevision: int, attempt: int, result: C::TriageOutcome): bool =
  C::canFinishTriage(r.journey.privateCase, appealRevision, attempt, result)
pure def finishTriage(r: ReportNotices, appealRevision: int, attempt: int, result: C::TriageOutcome): ReportNotices =
  { ...r, journey: { ...r.journey, privateCase: C::finishTriage(r.journey.privateCase, appealRevision, attempt, result) } }
pure def alwaysAdviceUsesReceiptExclusions(r: ReportNotices): bool = J::alwaysAdviceUsesReceiptExclusions(r.journey)
pure def sometimesTriageWithContext(r: ReportNotices): bool = r.journey.privateCase.triage.state == C::TriageComplete
  and r.journey.privateCase.triage.matchedLine > r.journey.privateCase.triage.exclusions.defaults
pure def sometimesAssessedWithContext(r: ReportNotices): bool = J::sometimesAssessmentShown(r.journey)
  and r.journey.assessment.attempts.getOr(r.journey.assessment.shown, A::noAttempt).exclusions.owner.length() > 0
```

## Story: Forward to GitHub and bind one verified receipt

### Created and reconciled copies bind the earliest canonical GHSA

Forwarding runs on the composed report's journal with the reporter's own
requests and keeps [forwarding's](./forwarding.md) earliest canonical copy
among its binding copies. An empty complete listing after the quiet window
reopens the draft and leaves the case unchanged.

```quint
pure def canClaimSend(r: ReportNotices, request: F::Request, startedAtMs: int): bool =
  request.actor == caseReporter(r) and J::canClaimSend(r.journey, request, startedAtMs)
pure def claimSend(r: ReportNotices, request: F::Request, startedAtMs: int): ReportNotices =
  { ...r, journey: J::claimSend(r.journey, request, startedAtMs) }
pure def canRecordClaimRead(r: ReportNotices, readback: F::ClaimRead): bool = J::canRecordClaimRead(r.journey, readback)
pure def recordClaimRead(r: ReportNotices, readback: F::ClaimRead): ReportNotices = { ...r, journey: J::recordClaimRead(r.journey, readback) }
pure def canStartPost(r: ReportNotices, claim: F::SendClaim): bool = J::canStartPost(r.journey, claim)
pure def startPost(r: ReportNotices, claim: F::SendClaim): ReportNotices = { ...r, journey: J::startPost(r.journey, claim) }
pure def canRecordPostResult(r: ReportNotices, claim: F::SendClaim, postResult: F::PostResult): bool =
  J::canRecordPostResult(r.journey, claim, postResult)
pure def recordPostResult(r: ReportNotices, claim: F::SendClaim, postResult: F::PostResult): ReportNotices =
  { ...r, journey: J::recordPostResult(r.journey, claim, postResult) }
pure def withForwarding(f: F::Forwarding, r: ReportNotices): ReportNotices = { ...r, journey: { ...r.journey, forwarding: f } }
pure def canMarkInterrupted(r: ReportNotices, nowMs: int): bool = F::canMarkInterrupted(r.journey.forwarding, nowMs)
pure def markInterrupted(r: ReportNotices, nowMs: int): ReportNotices = withForwarding(F::markInterrupted(r.journey.forwarding, nowMs), r)
pure def canHoldLateCopy(r: ReportNotices, claim: F::SendClaim, seenRevision: int, accepted: F::Copy): bool =
  F::canHoldLateCopy(r.journey.forwarding, claim, seenRevision, accepted)
pure def holdLateCopy(r: ReportNotices, claim: F::SendClaim, seenRevision: int, accepted: F::Copy): ReportNotices =
  withForwarding(F::holdLateCopy(r.journey.forwarding, claim, seenRevision, accepted), r)
pure def namesDirectCase(r: ReportNotices, copy: F::Copy): bool = r.directChecked and copy.ghsa == r.directAdvisory.ghsa
pure def canRecordCreated(r: ReportNotices, claim: F::SendClaim, accepted: F::Copy, listing: F::Listing): bool =
  F::canRecordCreated(r.journey.forwarding, claim, accepted, listing)
    and not(namesDirectCase(r, accepted)) and not(listing.copies.some(copy => namesDirectCase(r, copy)))
pure def recordCreated(r: ReportNotices, claim: F::SendClaim, accepted: F::Copy, listing: F::Listing): ReportNotices =
  withForwarding(F::recordCreated(r.journey.forwarding, claim, accepted, listing), r)
pure def canReconcileCopies(r: ReportNotices, request: F::Request, listing: F::Listing, nowMs: int): bool =
  request.actor == caseReporter(r) and F::canReconcile(r.journey.forwarding, request, listing, nowMs)
    and not(listing.copies.some(copy => namesDirectCase(r, copy)))
pure def reconcileCopies(r: ReportNotices, request: F::Request, listing: F::Listing, nowMs: int): ReportNotices =
  withForwarding(F::reconcile(r.journey.forwarding, request, listing, nowMs), r)
pure def alwaysCanonicalIsEarliestBindingCopy(r: ReportNotices): bool = F::alwaysCanonicalIsEarliestBindingCopy(r.journey.forwarding)
pure def stepCanonicalFixed(before: ReportNotices, after: ReportNotices): bool =
  F::stepCanonicalFixed(before.journey.forwarding, after.journey.forwarding)
pure def sometimesSubmittedWithDuplicates(r: ReportNotices): bool = r.journey.forwarding.phase == F::Submitted
  and F::sometimesDuplicates(r.journey.forwarding)
pure def sometimesReopenedAfterEmptyListing(r: ReportNotices): bool = r.journey.forwarding.phase == F::Draft
  and r.journey.forwarding.retryWithoutCopy and r.journey.forwarding.attempt > 0 and r.journey.privateCase.submission == C::Verified
```

### A verified GitHub receipt links only the retained case

The advisory read links the receipt to the retained case of this reporter
and repository. The GitHub receipt never rewrites the Slop receipt: every
forwarding step keeps the intake receipt time, the case and the reporter's
Inbox receipt. An unverifiable copy fails forwarding and keeps the case.

```quint
pure def canReadReceipt(r: ReportNotices, request: F::Request, advisoryRead: F::AdvisoryRead): bool =
  request.actor == caseReporter(r) and F::canReadReceipt(r.journey.forwarding, request, advisoryRead)
pure def readReceipt(r: ReportNotices, request: F::Request, advisoryRead: F::AdvisoryRead): ReportNotices =
  withForwarding(F::readReceipt(r.journey.forwarding, request, advisoryRead), r)
pure def canExpireVerification(r: ReportNotices, nowMs: int): bool = F::canExpireVerification(r.journey.forwarding, nowMs)
pure def expireVerification(r: ReportNotices, nowMs: int): ReportNotices = withForwarding(F::expireVerification(r.journey.forwarding, nowMs), r)
pure def canLoseReceiptReply(r: ReportNotices): bool = F::canLoseReceiptReply(r.journey.forwarding)
pure def loseReceiptReply(r: ReportNotices): ReportNotices = withForwarding(F::loseReceiptReply(r.journey.forwarding), r)
pure def forwardingStep(via: str): bool = via == "claimSend" or via == "recordClaimRead" or via == "startPost"
  or via == "recordPostResult" or via == "markInterrupted" or via == "holdLateCopy" or via == "recordCreated"
  or via == "reconcileCopies" or via == "readReceipt" or via == "expireVerification" or via == "loseReceiptReply"
pure def alwaysVerifiedReceiptLinksRetainedCase(r: ReportNotices): bool =
  val f = r.journey.forwarding
  f.phase == F::ReceiptVerified implies r.journey.privateCase.submission == C::Verified and f.reporter == caseReporter(r)
    and f.repository == r.journey.intake.repository and f.canonical.ghsa > 0
pure def alwaysUnverifiableKeepsCase(r: ReportNotices): bool =
  r.journey.forwarding.failure == F::Unverifiable implies r.journey.privateCase.submission == C::Verified
pure def stepForwardingKeepsSlopReceipt(before: ReportNotices, via: str, after: ReportNotices): bool = forwardingStep(via) implies
  after.journey.intake == before.journey.intake and after.journey.privateCase == before.journey.privateCase
    and after.inbox == before.inbox
pure def sometimesReceiptVerified(r: ReportNotices): bool = r.journey.forwarding.phase == F::ReceiptVerified
  and r.journey.privateCase.source == C::SlopReceived
pure def sometimesUnverifiableKeepsCase(r: ReportNotices): bool = r.journey.forwarding.failure == F::Unverifiable
  and r.journey.privateCase.submission == C::Verified
```

### A legacy direct report is received only from a checked GitHub receipt

A report filed on GitHub first becomes a case of its own, separate from the
composed report, only when the direct-origin check of the live private
advisory names this reporter and the project's repository, the advisory
carries no Slop submission marker of the composed report and forwarding has
not bound its GHSA. Forwarding never binds that GHSA afterwards. Its receipt
time is the advisory's GitHub creation time, and its terms are the ones the
program issued at that time. The same step saves the reporter's Inbox
receipt under the direct report's own key.

```quint
pure def directTerms(r: ReportNotices, advisoryRead: F::AdvisoryRead): T::ReceiptTerms =
  P::receiptTerms(r.journey.program, advisoryRead.facts.createdAtMs)
pure def canReceiveDirect(r: ReportNotices, advisoryRead: F::AdvisoryRead, direct: F::DirectRequest): bool =
  val f = r.journey.forwarding
  F::directReceiptCheck(direct, advisoryRead) == F::DirectReceipt and direct.reporter == r.directCase.reporter
    and direct.repository == f.repository and advisoryRead.facts.marker != f.marker
    and direct.ghsa != f.canonical.ghsa and not(f.duplicateGhsas.includes(direct.ghsa))
    and C::canReceive(r.directCase, C::GithubVerified, directTerms(r, advisoryRead), C::NewReceipt, M::zero, 1)
    and N::canSave(r.inbox, noticeKey(DirectReportReceived, direct.ghsa), N::SecurityReportReceived, r.directCase.reporter)
pure def receiveDirect(r: ReportNotices, advisoryRead: F::AdvisoryRead, direct: F::DirectRequest): ReportNotices =
  { ...r, directChecked: true, directAdvisory: advisoryRead.facts,
    directCase: C::receive(r.directCase, C::GithubVerified, directTerms(r, advisoryRead), C::NewReceipt, M::zero, 1),
    inbox: N::save(r.inbox, noticeKey(DirectReportReceived, direct.ghsa), N::SecurityReportReceived, r.directCase.reporter) }
pure def alwaysDirectCaseChecked(r: ReportNotices): bool =
  (r.directCase.submission != C::NotReceived implies r.directCase.source == C::GithubVerified and r.directChecked)
  and (r.directChecked implies r.directCase.submission == C::Verified)
pure def alwaysDirectCaseSeparate(r: ReportNotices): bool =
  val f = r.journey.forwarding
  r.directChecked implies r.directAdvisory.ghsa > 0 and r.directAdvisory.marker != f.marker
    and r.directAdvisory.ghsa != f.canonical.ghsa and not(f.duplicateGhsas.includes(r.directAdvisory.ghsa))
    and r.directCase.terms.receivedAt == r.directAdvisory.createdAtMs
pure def sometimesDirectReceived(r: ReportNotices): bool = r.directCase.source == C::GithubVerified
```

### Simulation samples

```quint
pure val bodyValues = Set("report", "revision")
pure val digestOfValues = Set({ object: 1, version: "revised" }, { object: 1, version: "new" })
pure val availabilityValues = Set(I::Unavailable, I::Enabled)
pure val directValues = Set({ ghsa: 3, repository: 1, reporter: 1 }, { ghsa: 2, repository: 1, reporter: 1 }, { ghsa: 3, repository: 1, reporter: 3 })
pure val byValues = Set(1, 2)
pure val nowMsValues = Set(2, 1300000, 87400001)
pure val requestValues = Set(1, 3, 4).map(revision => { id: 1, revision: revision, actor: 1, session: 1, checkedAtSeconds: 10, grant: F::capturedGrant })
pure val readbackValues = Set({ requestId: 1, changedOne: true, rowPresent: true, observedRevision: 2, observedPhase: F::Submitting })
pure val claimValues = Set({ revision: 2, requestId: 1, attempt: 1, atMs: 1000000, reportVersion: 1, digest: "original" })
pure val postResultValues = Set(F::CopyUnknown, F::ThrottledNoCopy)
pure val listingValues = Set({ ...F::baseListing, copies: List(F::lateCopy, F::earlyCopy) }, F::baseListing)
pure val acceptedValues = Set(F::earlyCopy)
pure val githubFirstReceipt: F::AdvisoryRead = { ...F::earlyReceipt, facts: { ...F::earlyCopy, ghsa: 3, marker: 0, digest: "direct" } }
pure val advisoryReadValues = Set(F::earlyReceipt, githubFirstReceipt)
pure val tokenValues = Set({ revision: 2, version: 1, digest: "original" }, { revision: 3, version: 2, digest: "revised" })
pure val offerExclusions: T::ExclusionContext = { defaults: T::slopDefaultExclusionCount, owner: P::standardOffer.excludedFindings }
pure val inputValues = Set({ exactVersionLoaded: true, duplicateEvidence: false, route: S::Surplus, exclusions: offerExclusions })
pure val observationValues = Set(S::Proposal({ phase: S::Legitimate, validResponse: true, matchesPriorCase: false, suppliedPriorCases: false, matchedLine: 12 }),
  S::Proposal({ phase: S::Spam, validResponse: true, matchesPriorCase: false, suppliedPriorCases: false, matchedLine: 0 }))
pure val resultValues = Set(C::Drafted({ returnCase: false, confidencePercent: 95, exclusions: offerExclusions, matchedLine: 12 }),
  C::TriageFailedResult)
pure val decisionValues = Set({ finding: C::Rejected, severity: T::SeverityUnset, loss: T::LossUnset, inScope: false, rootCause: 0,
  duplicateOf: 0, declareRelated: false })
pure val attemptValues = Set(1)
pure val completeValues = Set(true)
pure val elapsedMsValues = Set(1000)
pure val weight_begin = 10
pure val weight_verifyObject = 10
pure val weight_commitReceipt = 10
pure val weight_observeAuthority = 6
pure val weight_claimScreening = 10
pure val weight_finishScreening = 10
pure val weight_route = 10
pure val weight_claimSend = 20
pure val weight_recordClaimRead = 30
pure val weight_startPost = 30
pure val weight_recordPostResult = 30
pure val weight_recordCreated = 15
pure val weight_markInterrupted = 10
pure val weight_reconcileCopies = 30
pure val weight_readReceipt = 30
pure val weight_expireVerification = 10
pure val weight_finishTriage = 10
```

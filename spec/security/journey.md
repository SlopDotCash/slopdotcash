# Composed private report flow

PRD sections 8 and 10 describe one private report journey: a durable Slop
receipt under the program's receipt-time terms, private screening, optional
human routing review, a version-bound maintainer assessment, a human case
decision and optional reporter-authorized GitHub forwarding. Each part is its
own machine: [program terms](./program.md), [intake](./intake.md),
[screening](./screening.md), [case](./cases.md), [assessment](./assessment.md)
and [forwarding](./forwarding.md). This machine holds one of each for one
report and supplies every cross-machine fact from their state, so no part
trusts a copy another caller provides. Cross-case exclusivity and funding
belong to the [project bounty machine](./bounty.md).

## Story: Carry one report from durable receipt to a decision and optional forwarding

### The receipt creates the case and the first screening version under the program's terms

The program issues the terms at the receipt time. A program paused or
closed after receipt leaves the case's frozen terms unchanged. Nothing is
screened, assessed, decided or forwarded before the atomic receipt.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import program as P from "./program"
import intake as I from "./intake"
import screening as S from "./screening"
import cases as C from "./cases"
import assessment as A from "./assessment"
import forwarding as F from "./forwarding"
type Journey = { program: P::Program, intake: I::Intake, screening: S::Screening, privateCase: C::PrivateCase,
  assessment: A::Assessment, forwarding: F::Forwarding, reportingReady: bool }
pure val openProgram: P::Program = { ...P::initial, project: "umia", offer: P::standardOffer, revision: 1, publishedAt: 1, revisions: List(1) }
pure val initial: Journey = { program: openProgram, intake: I::initial, screening: S::initial, privateCase: C::initial,
  assessment: A::initial, forwarding: F::initial, reportingReady: true }
pure def received(r: Journey): bool = r.intake.phase == I::Received
pure def canBegin(r: Journey, key: int, digest: int, reporter: int, repository: int, projectRevision: int, nowMs: int): bool =
  I::canBegin(r.intake, key, digest, reporter, repository, projectRevision, nowMs) and reporter == r.privateCase.reporter
pure def begin(r: Journey, key: int, digest: int, reporter: int, repository: int, projectRevision: int, nowMs: int): Journey =
  { ...r, intake: I::begin(r.intake, key, digest, reporter, repository, projectRevision, nowMs) }
pure def canVerifyObject(r: Journey, digest: int): bool = I::canVerifyObject(r.intake, digest)
pure def verifyObject(r: Journey, digest: int): Journey = { ...r, intake: I::verifyObject(r.intake, digest) }
pure def canCommitReceipt(r: Journey, receivedAt: int): bool =
  I::canCommitReceipt(r.intake, receivedAt, P::receiptTerms(r.program, receivedAt))
    and C::canReceive(r.privateCase, C::SlopReceived, P::receiptTerms(r.program, receivedAt), C::NewReceipt, M::zero, 1)
pure def commitReceipt(r: Journey, receivedAt: int): Journey =
  val terms = P::receiptTerms(r.program, receivedAt)
  { ...r, intake: I::commitReceipt(r.intake, receivedAt, terms),
    privateCase: C::receive(r.privateCase, C::SlopReceived, terms, C::NewReceipt, M::zero, 1) }
pure def canPublish(r: Journey, by: int, owner: P::VerifiedOwner, offer: P::Offer, nowMs: int): bool = P::canPublish(r.program, by, owner, offer, nowMs)
pure def publish(r: Journey, by: int, owner: P::VerifiedOwner, offer: P::Offer, nowMs: int): Journey =
  { ...r, program: P::publish(r.program, by, owner, offer, nowMs) }
pure def canObserveAuthority(r: Journey, snapshot: C::Authority): bool = received(r) and C::canObserveAuthority(r.privateCase, snapshot)
  and A::canObserveAuthority(r.assessment, snapshot)
pure def observeAuthority(r: Journey, snapshot: C::Authority): Journey =
  { ...r, privateCase: C::observeAuthority(r.privateCase, snapshot), assessment: A::observeAuthority(r.assessment, snapshot) }
pure def alwaysNothingBeforeReceipt(r: Journey): bool = not(received(r)) implies r.privateCase.submission == C::NotReceived
  and r.screening.revision == 1 and r.screening.version == 1 and r.screening.phase == S::Queued and r.screening.review == S::PendingReview
  and r.forwarding.attempt == 0 and r.assessment.count == 0 and r.assessment.qualifiedVersion == 0 and r.assessment.reportVersion == 1
pure def alwaysCaseHoldsReceiptTerms(r: Journey): bool = received(r) implies r.privateCase.submission == C::Verified
  and r.privateCase.terms == r.intake.terms and r.privateCase.terms.receivedAt == r.intake.receivedAt
pure def sometimesPaidCase(r: Journey): bool = r.privateCase.submission == C::Verified and r.privateCase.terms.paidTerms
pure def sometimesUnpaidAfterPause(r: Journey): bool = r.privateCase.submission == C::Verified and not(r.privateCase.terms.paidTerms)
  and r.program.offer.status != P::Open
pure def sometimesPausedAfterPaidReceipt(r: Journey): bool = r.privateCase.terms.paidTerms and r.program.offer.status == P::Paused
```

### Screening, human routing review and owner notification use the live records

Only received reports are screened. Routing review and the routing context
come from the case's current technical roles; the reporter never reviews
their own report. Screening routes the only owner notification.

```quint
pure def canClaimScreening(r: Journey, seenRevision: int, nowMs: int): bool = received(r) and S::canClaim(r.screening, seenRevision, nowMs, true)
pure def claimScreening(r: Journey, seenRevision: int, nowMs: int): Journey = { ...r, screening: S::claim(r.screening, seenRevision, nowMs, true) }
pure def canFinishScreening(r: Journey, token: S::Claim, input: S::Input, observation: S::Observation): bool =
  received(r) and S::canFinish(r.screening, token, input, observation)
pure def finishScreening(r: Journey, token: S::Claim, input: S::Input, observation: S::Observation): Journey =
  { ...r, screening: S::finish(r.screening, token, input, observation) }
pure def canReviewReport(r: Journey, by: int, checkedEpoch: int, seenRevision: int, routingDecision: S::Review): bool = received(r)
  and S::canReviewReport(r.screening, by, seenRevision, routingDecision, C::technicalNow(r.privateCase, by, checkedEpoch), true)
pure def reviewReport(r: Journey, by: int, checkedEpoch: int, seenRevision: int, routingDecision: S::Review): Journey =
  { ...r, screening: S::reviewReport(r.screening, by, seenRevision, routingDecision, true, true) }
pure def routingContext(r: Journey): S::Routing = { checkedContext: r.privateCase.authority.epoch > 0,
  eligibleRecipients: r.privateCase.authority.technical.some(t => t != r.privateCase.reporter), actingTechnicalApprover: false }
pure def canRoute(r: Journey, seenRevision: int): bool = received(r) and S::canRoute(r.screening, seenRevision, routingContext(r))
pure def route(r: Journey, seenRevision: int): Journey = { ...r, screening: S::route(r.screening, seenRevision, routingContext(r)) }
pure def sometimesRouted(r: Journey): bool = r.screening.routed
pure def sometimesHumanForwarded(r: Journey): bool = r.screening.review == S::Forward and r.screening.phase != S::Legitimate
```

### A reporter revision needs the forwarding draft, the open case and admission, and advances every version together

A revision is saved only while no GitHub copy exists and forwarding is a draft
or failure, while the case is received or needs information and holds no
committed award, and within the reporter's admission window. The case,
screening and assessment move to the same new version; a decision prepared on
the older version can no longer commit, and an older assessment is hidden.

```quint
pure def revisionEvidence(r: Journey, by: int, nowMs: int): S::RevisionEvidence = {
  isReporter: by == r.privateCase.reporter,
  draftOrFailed: r.forwarding.phase == F::Draft or r.forwarding.phase == F::Failed,
  noAdvisory: r.forwarding.canonical.ghsa == 0,
  caseNeedsInformation: r.privateCase.receipt == C::NeedsInformation,
  exactCaseCas: true,
  allowedCaseState: C::canReviseReport(r.privateCase, by, r.screening.version + 1),
  exactObjectStored: true,
  admitted: I::recentAdmissions(r.intake, nowMs) < 10 }
pure def canReplace(r: Journey, by: int, seenRevision: int, revisedDigest: str, nowMs: int): bool = received(r) and nowMs > 0
  and S::canReplace(r.screening, seenRevision, revisedDigest, revisionEvidence(r, by, nowMs))
  and A::canObserveVersion(r.assessment, r.screening.version + 1)
pure def replace(r: Journey, by: int, seenRevision: int, revisedDigest: str, nowMs: int): Journey =
  { ...r, screening: S::replace(r.screening, seenRevision, revisedDigest, revisionEvidence(r, by, nowMs)),
    privateCase: C::reviseReport(r.privateCase, by, r.screening.version + 1),
    assessment: A::observeVersion(r.assessment, r.screening.version + 1) }
pure def canRequestInformation(r: Journey, by: int, checkedEpoch: int): bool = C::canRequestInformation(r.privateCase, by, checkedEpoch)
pure def requestInformation(r: Journey, by: int, checkedEpoch: int): Journey = { ...r, privateCase: C::requestInformation(r.privateCase, by, checkedEpoch) }
pure def canDecide(r: Journey, by: int, checkedEpoch: int, decision: C::Decision): bool =
  C::canDecide(r.privateCase, by, checkedEpoch, r.screening.version, decision)
pure def decide(r: Journey, by: int, checkedEpoch: int, decision: C::Decision): Journey =
  { ...r, privateCase: C::decide(r.privateCase, by, checkedEpoch, r.screening.version, decision) }
pure def alwaysVersionsAligned(r: Journey): bool = received(r) implies r.privateCase.reportVersion == r.screening.version
  and r.assessment.reportVersion == r.screening.version
pure def stepCommittedReportUnchanged(before: Journey, after: Journey): bool = C::committed(before.privateCase) implies
  after.screening.version == before.screening.version and after.screening.digest == before.screening.digest
pure def sometimesRevisedThenDecided(r: Journey): bool = r.screening.version > 1 and r.privateCase.receipt != C::Received
  and r.privateCase.receipt != C::NeedsInformation and r.privateCase.receipt != C::Triaging
```

### The maintainer assessment starts only for a qualified current version

```quint
pure def canObserveQualified(r: Journey): bool = received(r) and S::qualified(r.screening)
  and A::canObserveQualified(r.assessment, r.screening.version)
pure def observeQualified(r: Journey): Journey = { ...r, assessment: A::observeQualified(r.assessment, r.screening.version) }
pure def canStartAssessment(r: Journey, nowMs: int): bool = A::canStartAutomatic(r.assessment, nowMs)
pure def startAssessment(r: Journey, nowMs: int): Journey = { ...r, assessment: A::startAutomatic(r.assessment, nowMs) }
pure def canFinishAssessment(r: Journey, attempt: int, complete: bool, elapsedMs: int): bool = A::canFinish(r.assessment, attempt, complete, elapsedMs)
pure def finishAssessment(r: Journey, attempt: int, complete: bool, elapsedMs: int): Journey =
  { ...r, assessment: A::finish(r.assessment, attempt, complete, elapsedMs) }
pure def alwaysQualifiedVersionNotAhead(r: Journey): bool = r.assessment.qualifiedVersion <= r.screening.version
pure def sometimesAssessmentShown(r: Journey): bool = r.assessment.shown > 0
```

### Forwarding sends only the current qualified version with the reporter's grant

The send gate is built from the live screening, intake and readiness
records. A participation ban refuses the claim. A failed or throttled
attempt reopens revision; a copy in flight or on GitHub blocks it.

```quint
pure def sendGate(r: Journey): F::SendGate = { seenScreeningRevision: r.screening.revision, reportVersion: r.screening.version,
  digest: r.screening.digest, screening: r.screening, bytesVerified: r.intake.objectVerified, intakeCurrent: received(r),
  reportingReady: r.reportingReady, allowedToParticipate: not(r.intake.banned), wonClaim: true }
pure def canObserveReadiness(r: Journey, ready: bool): bool = ready != r.reportingReady
pure def observeReadiness(r: Journey, ready: bool): Journey = { ...r, reportingReady: ready }
pure def canObserveBan(r: Journey, banned: bool): bool = I::canObserveBan(r.intake, banned)
pure def observeBan(r: Journey, banned: bool): Journey = { ...r, intake: I::observeBan(r.intake, banned) }
pure def canClaimSend(r: Journey, request: F::Request, startedAtMs: int): bool = F::canClaimSend(r.forwarding, request, sendGate(r), startedAtMs)
pure def claimSend(r: Journey, request: F::Request, startedAtMs: int): Journey =
  { ...r, forwarding: F::claimSend(r.forwarding, request, sendGate(r), startedAtMs) }
pure def canRecordClaimRead(r: Journey, readback: F::ClaimRead): bool = F::canRecordClaimRead(r.forwarding, readback)
pure def recordClaimRead(r: Journey, readback: F::ClaimRead): Journey = { ...r, forwarding: F::recordClaimRead(r.forwarding, readback) }
pure def canStartPost(r: Journey, claim: F::SendClaim): bool = F::canStartPost(r.forwarding, claim)
pure def startPost(r: Journey, claim: F::SendClaim): Journey = { ...r, forwarding: F::startPost(r.forwarding, claim) }
pure def canRecordPostResult(r: Journey, claim: F::SendClaim, postResult: F::PostResult): bool = F::canRecordPostResult(r.forwarding, claim)
pure def recordPostResult(r: Journey, claim: F::SendClaim, postResult: F::PostResult): Journey =
  { ...r, forwarding: F::recordPostResult(r.forwarding, claim, postResult) }
pure def stepSendNeedsCurrentQualifiedReport(before: Journey, after: Journey): bool =
  (after.forwarding.attempt > before.forwarding.attempt) implies received(before) and S::qualified(before.screening)
    and not(before.intake.banned) and before.reportingReady
    and after.forwarding.activeClaim.reportVersion == before.screening.version and after.forwarding.activeClaim.digest == before.screening.digest
pure def alwaysSendFollowsReceipt(r: Journey): bool = r.forwarding.attempt >= 0 and (r.forwarding.attempt > 0 implies received(r))
pure def sometimesSendInFlight(r: Journey): bool = r.forwarding.phase == F::Submitting
```

### Simulation samples

```quint
pure val keyValues = Set(1)
pure val digestValues = Set(1)
pure val revisedDigestValues = Set("revised", "new")
pure val reporterValues = Set(1)
pure val repositoryValues = Set(1)
pure val projectRevisionValues = Set(1)
pure val nowMsValues = Set(2, 3)
pure val receivedAtValues = Set(2)
pure val byValues = Set(1, 2, 7)
pure val checkedEpochValues = Set(1)
pure val snapshotValues = Set(C::staff)
pure val readyValues = Set(true, false)
pure val bannedValues = Set(true, false)
pure val ownerValues = Set({ actor: 7, project: "umia", projectRevision: 1 })
pure val offerValues = Set({ ...P::standardOffer, status: P::Paused })
pure val seenRevisionValues = Set(1, 2, 3, 4, 5, 6)
pure val startedAtMsValues = Set(1000000)
pure val weight_commitReceipt = 10
pure val weight_begin = 6
pure val weight_verifyObject = 8
pure val weight_publish = 3
pure val weight_finishScreening = 20
pure val weight_claimSend = 10
```

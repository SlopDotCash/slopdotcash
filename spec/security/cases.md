# Private case review, awards and appeals

PRD sections 8 and 10 keep receipt, remediation, award, payment and
disclosure as independent states of one permanent private case
(remediation and disclosure in [their own machine](./remediation.md))
(`security_cases`, migrations `0026`, `0028`, `0061` and `0101`). Actor 1 is
the representative reporter. Every other actor's authority comes from the
current `Authority` snapshot, never from an event parameter: the shell
computes it on each request from the session and the current project
revision (technical approvers and financial approvers from the project's
GitHub authority and program roles, moderators from
`PROJECT_MODERATOR_GITHUB_IDS`, participation bans from the access service,
related parties from the program's approvers, dispute contacts and sponsor,
and the program restriction from the enforcement record). A newer snapshot
replaces the old one and advances its epoch, so a decision prepared under a
revoked role cannot commit. Triager membership is case state.

Owner decision D10 (`backend/security/README.md`, "Roles") lets one person
hold the technical and financial roles. Powers stay separate per role: a
triager cannot decide, a financial approver sees only award and payment
fields, and a moderator decides only appeals and related-party reviews.

## Story: Receive a permanent private case under frozen terms

### A case is received once, from a Slop receipt, a verified GitHub receipt or a confirmed legacy claim

A Slop or GitHub-verified receipt is created by the intake and forwarding
specifications with terms the [program](./program.md) issued at receipt. A
legacy reporter claim (before which no finding, award, appeal or
relatedness exists) stays a claim until a current technical approver
verifies that the GitHub advisory names this reporter, freezing the terms in
force at the maintainer-attested receipt time, or rejects the link. The
receipt guard checks the full term validity (`T::validReceipt`); the terms
then never change (`stepReceiptFrozen`). Cases
received before discretionary awards arrive through the migration import
with their reserved or capacity-exhausted award. The receipt, its source and
its terms are immutable once verified.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
type Submission = NotReceived | Claimed | Verified | LinkRejected
type ReceiptSource = NoSource | SlopReceived | GithubVerified | MaintainerAttested
type Historical = NewReceipt | ImportedReservation | ImportedCapacityWait
type Receipt = Received | NeedsInformation | Triaging | Confirmed | Duplicate | OutOfScope | Rejected | Disputed
type Award = NotApplicable | Pending | Ineligible | Reserved | CapacityExhausted | Approved
type Commitment = NoCommitment | VaultReservation | DirectAward | FullAwardHeld
type PaymentState = PaymentNotApplicable | RailUnavailable
type Related = NotAssessed | Unrelated | RelatedParty
type RelatedReview = ReviewNotApplicable | ReviewPending | ReviewApproved | ReviewRefused
type AppealState = NoAppeal | AppealOpen | Upheld | Returned
type TriageState = NoTriage | TriageQueued | TriageRunning | TriageComplete | TriageFailed | TriageUnavailable
type Authority = { epoch: int, technical: List[int], financial: List[int], moderators: List[int], banned: List[int],
  relatedParties: List[int], programRestricted: bool }
type AppealRecord = { from: Receipt, resolution: AppealState, by: int }
type Triage = { state: TriageState, appealRevision: int, attempt: int, startedAt: int, escalated: bool, belowFloor: bool, returnDraft: bool }
type PrivateCase = { reporter: int, submission: Submission, source: ReceiptSource, terms: T::ReceiptTerms, revision: int,
  reportVersion: int, authority: Authority, triagers: List[int], revokedTriagers: List[int], memberEvents: int,
  receipt: Receipt, severity: T::Severity, loss: T::LossFinding, inScope: bool, rootCause: int, duplicateOf: int,
  award: Award, grossChosen: M::Amount, commitment: Commitment, payment: PaymentState,
  related: Related, relatedReview: RelatedReview, deciders: List[int],
  appeal: AppealState, appealFrom: Receipt, appealHistory: List[AppealRecord], triage: Triage }
pure val noAuthority: Authority = { epoch: 0, technical: List(), financial: List(), moderators: List(), banned: List(),
  relatedParties: List(), programRestricted: false }
pure val noAppealRecord: AppealRecord = { from: Received, resolution: NoAppeal, by: 0 }
pure val noTriage: Triage = { state: NoTriage, appealRevision: 0, attempt: 0, startedAt: 0, escalated: false, belowFloor: false, returnDraft: false }
pure val initial: PrivateCase = { reporter: 1, submission: NotReceived, source: NoSource, terms: T::unpaidTerms(0, 0), revision: 0,
  reportVersion: 0, authority: noAuthority, triagers: List(), revokedTriagers: List(), memberEvents: 0,
  receipt: Received, severity: T::SeverityUnset, loss: T::LossUnset, inScope: false, rootCause: 0, duplicateOf: 0,
  award: NotApplicable, grossChosen: M::zero, commitment: NoCommitment, payment: PaymentNotApplicable,
  related: NotAssessed, relatedReview: ReviewNotApplicable, deciders: List(),
  appeal: NoAppeal, appealFrom: Received, appealHistory: List(), triage: noTriage }
pure def historicalAllowed(terms: T::ReceiptTerms, history: Historical, gross: M::Amount): bool =
  history == NewReceipt or (terms.paidTerms and terms.fundingPolicy == T::Prefunded
    and (history == ImportedCapacityWait or T::amountAllowed(terms, gross)))
pure def canReceive(c: PrivateCase, source: ReceiptSource, terms: T::ReceiptTerms, history: Historical, gross: M::Amount, reportVersion: int): bool =
  c.submission == NotReceived and (source == SlopReceived or source == GithubVerified) and T::validReceipt(terms)
    and reportVersion > 0 and historicalAllowed(terms, history, gross)
pure def receive(c: PrivateCase, source: ReceiptSource, terms: T::ReceiptTerms, history: Historical, gross: M::Amount, reportVersion: int): PrivateCase =
  { ...c, submission: Verified, source: source, terms: terms, revision: 1, reportVersion: reportVersion,
    award: if (not(terms.paidTerms)) NotApplicable else if (history == ImportedReservation) Reserved
      else if (history == ImportedCapacityWait) CapacityExhausted else Pending,
    grossChosen: if (history == ImportedReservation) gross else M::zero,
    commitment: if (history == ImportedReservation) VaultReservation else NoCommitment }
pure def canClaim(c: PrivateCase, by: int): bool = c.submission == NotReceived and by == c.reporter
pure def claim(c: PrivateCase, by: int): PrivateCase = { ...c, submission: Claimed, revision: 1 }
pure def technicalNow(c: PrivateCase, by: int, checkedEpoch: int): bool = checkedEpoch == c.authority.epoch and checkedEpoch > 0
  and c.authority.technical.includes(by) and by != c.reporter
pure def canVerifyLink(c: PrivateCase, by: int, checkedEpoch: int, terms: T::ReceiptTerms): bool =
  c.submission == Claimed and technicalNow(c, by, checkedEpoch) and T::validReceipt(terms)
pure def verifyLink(c: PrivateCase, by: int, checkedEpoch: int, terms: T::ReceiptTerms): PrivateCase =
  { ...c, submission: Verified, source: MaintainerAttested, terms: terms, revision: c.revision + 1, reportVersion: 1,
    award: if (terms.paidTerms) Pending else NotApplicable }
pure def canRejectLink(c: PrivateCase, by: int, checkedEpoch: int): bool = c.submission == Claimed and technicalNow(c, by, checkedEpoch)
pure def rejectLink(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase = { ...c, submission: LinkRejected, revision: c.revision + 1 }
pure def alwaysUnpaidHasNoAward(c: PrivateCase): bool = c.terms.paidTerms == (c.award != NotApplicable)
pure def alwaysVerifiedReceiptValid(c: PrivateCase): bool = (c.submission == Verified implies c.terms.revision > 0
  and c.terms.receivedAt > 0 and c.source != NoSource and c.reportVersion > 0 and c.revision > 0)
  and (c.submission != Verified implies c.award == NotApplicable)
pure def alwaysUnreceivedBlank(c: PrivateCase): bool = c.revision >= 0 and (c.submission != Verified implies
  c.receipt == Received and c.appeal == NoAppeal and c.commitment == NoCommitment and c.payment == PaymentNotApplicable
  and c.related == NotAssessed and c.relatedReview == ReviewNotApplicable and c.triage.state == NoTriage)
  and (c.submission == NotReceived implies c.revision == 0)
pure def stepReceiptFrozen(before: PrivateCase, after: PrivateCase): bool = after.reporter == before.reporter and
  (before.submission == Verified implies after.submission == Verified and after.terms == before.terms and after.source == before.source)
  and (before.submission == LinkRejected implies after.submission == LinkRejected) and after.revision >= before.revision
pure def sometimesLinkRejected(c: PrivateCase): bool = c.submission == LinkRejected
pure def sometimesAttestedReceipt(c: PrivateCase): bool = c.source == MaintainerAttested
pure def sometimesUnpaidReceipt(c: PrivateCase): bool = c.submission == Verified and c.award == NotApplicable
```

### Authority snapshots advance and triager membership is audited at the next revision

A newer verified snapshot replaces every role at once. A current technical
approver assigns or revokes a triager; the reporter can never triage their own
case. Membership history and its audit event stay with the case revision.

```quint
pure def canObserveAuthority(c: PrivateCase, snapshot: Authority): bool = snapshot.epoch > c.authority.epoch
pure def observeAuthority(c: PrivateCase, snapshot: Authority): PrivateCase = { ...c, authority: snapshot }
pure def canAssignTriager(c: PrivateCase, by: int, checkedEpoch: int, actor: int): bool = c.submission == Verified
  and technicalNow(c, by, checkedEpoch) and actor > 0 and actor != c.reporter and not(c.triagers.includes(actor))
pure def assignTriager(c: PrivateCase, by: int, checkedEpoch: int, actor: int): PrivateCase =
  { ...c, triagers: c.triagers.append(actor), revision: c.revision + 1, memberEvents: c.memberEvents + 1 }
pure def canRevokeTriager(c: PrivateCase, by: int, checkedEpoch: int, actor: int): bool = c.submission == Verified
  and technicalNow(c, by, checkedEpoch) and c.triagers.includes(actor)
pure def revokeTriager(c: PrivateCase, by: int, checkedEpoch: int, actor: int): PrivateCase =
  { ...c, triagers: c.triagers.select(t => t != actor), revokedTriagers: c.revokedTriagers.append(actor),
    revision: c.revision + 1, memberEvents: c.memberEvents + 1 }
pure def triagerNow(c: PrivateCase, by: int, checkedEpoch: int): bool = checkedEpoch == c.authority.epoch and checkedEpoch > 0
  and c.triagers.includes(by) and by != c.reporter
pure def moderatorNow(c: PrivateCase, by: int, checkedEpoch: int): bool = checkedEpoch == c.authority.epoch and checkedEpoch > 0
  and c.authority.moderators.includes(by) and by != c.reporter
pure def mayReadBody(c: PrivateCase, actor: int, checkedEpoch: int): bool = c.submission == Verified and
  (actor == c.reporter or technicalNow(c, actor, checkedEpoch) or triagerNow(c, actor, checkedEpoch)
    or (moderatorNow(c, actor, checkedEpoch) and (c.appeal == AppealOpen or c.relatedReview == ReviewPending)))
pure def mayReadAward(c: PrivateCase, actor: int, checkedEpoch: int): bool = mayReadBody(c, actor, checkedEpoch)
  or (checkedEpoch == c.authority.epoch and c.authority.financial.includes(actor) and (c.award == Approved or c.award == Reserved))
pure def alwaysTriagersExcludeReporter(c: PrivateCase): bool = not(c.triagers.includes(c.reporter))
pure def alwaysMembershipAudited(c: PrivateCase): bool = c.memberEvents >= c.revokedTriagers.length() and c.memberEvents >= 0
pure def stepMembershipHistoryRetained(before: PrivateCase, after: PrivateCase): bool =
  before.revokedTriagers.every(t => after.revokedTriagers.includes(t)) and after.memberEvents >= before.memberEvents
pure def sometimesTriagerRevoked(c: PrivateCase): bool = c.revokedTriagers.length() > 0
```

## Story: Obtain a human decision without automatic rejection

### Current technical approvers and triagers request information on the current report version

Screening is advisory and never sets these states. A current technical
approver or assigned triager asks for information. The reporter may save a
new immutable report version while the finding is open, including after a
returned appeal; it reopens triage and needs a fresh decision. A decision binds the report version
it read; a revision saved first makes that decision stale.

```quint
pure def receiptOpen(c: PrivateCase): bool = c.receipt == Received or c.receipt == NeedsInformation or c.receipt == Triaging
pure def committed(c: PrivateCase): bool = c.award == Approved or c.award == Reserved
pure def canRequestInformation(c: PrivateCase, by: int, checkedEpoch: int): bool = c.submission == Verified and receiptOpen(c)
  and (technicalNow(c, by, checkedEpoch) or triagerNow(c, by, checkedEpoch))
pure def requestInformation(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase = { ...c, receipt: NeedsInformation, revision: c.revision + 1 }
pure def canReviseReport(c: PrivateCase, by: int, version: int): bool = c.submission == Verified and by == c.reporter
  and receiptOpen(c) and not(committed(c)) and version == c.reportVersion + 1
pure def reviseReport(c: PrivateCase, by: int, version: int): PrivateCase =
  { ...c, reportVersion: version, receipt: if (c.receipt == NeedsInformation) Triaging else c.receipt, revision: c.revision + 1 }
pure def sometimesInformationProvided(c: PrivateCase): bool = c.receipt == Triaging and c.reportVersion > 1
```

### A technical decision records the finding, duplicate identity and relatedness

The reporter never decides their own case. Once a case is related it stays
related: a declaration, a program approver, dispute contact or sponsor
reporter makes it related. A committed award is never redecided.

```quint
type Decision = { finding: Receipt, severity: T::Severity, loss: T::LossFinding, inScope: bool, rootCause: int, duplicateOf: int, declareRelated: bool }
pure def reporterRelated(c: PrivateCase): bool = c.related == RelatedParty or c.authority.relatedParties.includes(c.reporter)
pure def canDecide(c: PrivateCase, by: int, checkedEpoch: int, version: int, decision: Decision): bool = c.submission == Verified
  and technicalNow(c, by, checkedEpoch) and receiptOpen(c) and not(committed(c)) and version == c.reportVersion
  and (decision.finding == Confirmed or decision.finding == Duplicate or decision.finding == OutOfScope or decision.finding == Rejected)
  and (decision.finding == Confirmed implies decision.rootCause > 0) and (decision.finding == Duplicate implies decision.duplicateOf > 0)
pure def decide(c: PrivateCase, by: int, checkedEpoch: int, version: int, decision: Decision): PrivateCase =
  { ...c, receipt: decision.finding, severity: decision.severity, loss: decision.loss, inScope: decision.inScope,
    rootCause: decision.rootCause, duplicateOf: decision.duplicateOf,
    related: if (decision.declareRelated or reporterRelated(c)) RelatedParty else Unrelated,
    deciders: c.deciders.append(by), revision: c.revision + 1 }
pure def alwaysDecidersExcludeReporter(c: PrivateCase): bool = not(c.deciders.includes(c.reporter))
pure def alwaysConfirmedHasRootCause(c: PrivateCase): bool =
  (c.receipt == Confirmed or (c.appeal == AppealOpen and c.appealFrom == Confirmed)) implies c.rootCause > 0
pure def stepRelatedPermanent(before: PrivateCase, after: PrivateCase): bool = before.related == RelatedParty implies after.related == RelatedParty
pure def stepDecidersRetained(before: PrivateCase, after: PrivateCase): bool = before.deciders.every(d => after.deciders.includes(d))
pure def sometimesDuplicate(c: PrivateCase): bool = c.receipt == Duplicate
```

### An award commits only under paid terms, eligibility and project clearance

The owner chooses the frozen after-approval amount, a historical
discretionary amount, or no award. A related-party award is a proposal that
commits nothing until an independent moderator approves it. Only the
[project bounty machine](./bounty.md) constructs `ProjectClearance`, from its
own record of every case, hold and funds snapshot of the project, bound to
this case revision. A banned reporter or decider, or a quarantined, banned or
retired program, starts no new commitment. A standard award commits to a
reviewed bounty-vault reservation or to a direct standard award. A full
award never uses either: it stays approved with no payment rail until a
full-award payment path is approved and released.
The [direct standard award journal](../settlement/directBounty.md) admits only
a `DirectAward` commitment of a standard split, through `D::caseApproval`.
Settlement owns verified funds, partial direct legs, successor requests and
exact payment proofs. A case and its fix form one financial work unit.

```quint
type Rail = NoRail | VaultRail | DirectRail
type ProjectClearance = { caseRevision: int, firstQualifying: bool, rootCauseFree: bool, rail: Rail }
pure def mayStartCommitment(c: PrivateCase, by: int, clearance: ProjectClearance): bool = clearance.caseRevision == c.revision
  and clearance.firstQualifying and clearance.rootCauseFree and not(c.authority.programRestricted)
  and not(c.authority.banned.includes(c.reporter)) and not(c.authority.banned.includes(by))
  and (c.terms.split == T::FullAward or clearance.rail != NoRail)
pure def committedWith(amount: M::Amount, rail: Rail, c: PrivateCase): PrivateCase =
  { ...c, award: Approved, grossChosen: amount,
    commitment: if (c.terms.split == T::FullAward) FullAwardHeld else if (rail == VaultRail) VaultReservation else DirectAward,
    payment: if (c.terms.split == T::FullAward) RailUnavailable else PaymentNotApplicable }
pure def awardOpen(c: PrivateCase): bool = c.submission == Verified and c.receipt == Confirmed and c.appeal != AppealOpen
  and (c.award == Pending or c.award == CapacityExhausted) and c.relatedReview != ReviewPending
pure def canDecideAward(c: PrivateCase, by: int, checkedEpoch: int, amount: M::Amount, clearance: ProjectClearance): bool =
  awardOpen(c) and technicalNow(c, by, checkedEpoch) and T::amountAllowed(c.terms, amount)
    and T::eligibleFinding(c.terms, c.inScope, c.severity, c.loss) and mayStartCommitment(c, by, clearance)
pure def decideAward(c: PrivateCase, by: int, checkedEpoch: int, amount: M::Amount, clearance: ProjectClearance): PrivateCase =
  val decided = { ...c, deciders: c.deciders.append(by), revision: c.revision + 1 }
  if (reporterRelated(c) and c.relatedReview != ReviewApproved)
    { ...decided, related: RelatedParty, relatedReview: ReviewPending, award: Pending, grossChosen: amount }
  else committedWith(amount, clearance.rail, decided)
pure def canDeclineAward(c: PrivateCase, by: int, checkedEpoch: int): bool = awardOpen(c) and technicalNow(c, by, checkedEpoch)
pure def declineAward(c: PrivateCase, by: int, checkedEpoch: int): PrivateCase =
  { ...c, award: Ineligible, grossChosen: M::zero, deciders: c.deciders.append(by), revision: c.revision + 1 }
pure def canReviewRelated(c: PrivateCase, by: int, checkedEpoch: int, approve: bool, clearance: ProjectClearance): bool =
  c.relatedReview == ReviewPending and c.receipt == Confirmed and c.award == Pending and c.appeal != AppealOpen
    and moderatorNow(c, by, checkedEpoch) and not(c.deciders.includes(by))
    and (approve implies mayStartCommitment(c, by, clearance) and T::amountAllowed(c.terms, c.grossChosen))
pure def reviewRelated(c: PrivateCase, by: int, checkedEpoch: int, approve: bool, clearance: ProjectClearance): PrivateCase =
  val reviewed = { ...c, relatedReview: if (approve) ReviewApproved else ReviewRefused, deciders: c.deciders.append(by), revision: c.revision + 1 }
  if (approve) committedWith(c.grossChosen, clearance.rail, reviewed) else { ...reviewed, award: Ineligible, grossChosen: M::zero }
pure def canApproveReservedAward(c: PrivateCase, by: int, checkedEpoch: int, amount: M::Amount): bool =
  c.award == Reserved and c.appeal != AppealOpen and technicalNow(c, by, checkedEpoch) and M::equalAmounts(amount, c.grossChosen)
pure def approveReservedAward(c: PrivateCase, by: int, checkedEpoch: int, amount: M::Amount): PrivateCase =
  { ...c, award: Approved, deciders: c.deciders.append(by), revision: c.revision + 1 }
pure def alwaysCommitmentMatchesAward(c: PrivateCase): bool = (c.commitment != NoCommitment) == committed(c)
  and (c.award == Reserved implies c.commitment == VaultReservation)
pure def alwaysApprovedWithinTerms(c: PrivateCase): bool = committed(c) implies T::amountAllowed(c.terms, c.grossChosen)
pure def alwaysFullAwardHeld(c: PrivateCase): bool = (c.terms.split == T::FullAward and committed(c)) implies
  c.commitment == FullAwardHeld and c.payment == RailUnavailable
pure def alwaysStandardAwardRail(c: PrivateCase): bool = (c.terms.split == T::StandardSplit and committed(c)) implies
  (c.commitment == VaultReservation or c.commitment == DirectAward) and c.payment == PaymentNotApplicable
pure def alwaysRelatedApproval(c: PrivateCase): bool = (c.related == RelatedParty and c.award == Approved) implies
  c.relatedReview == ReviewApproved
pure def alwaysCommittedFindingStands(c: PrivateCase): bool = committed(c) implies
  (c.receipt == Confirmed or receiptOpen(c)) and (c.award == Reserved implies c.related != RelatedParty)
pure def alwaysProposalCommitsNothing(c: PrivateCase): bool = c.relatedReview == ReviewPending implies
  c.receipt == Confirmed and c.appeal != AppealOpen and c.award == Pending and c.commitment == NoCommitment and c.related == RelatedParty and T::amountAllowed(c.terms, c.grossChosen)
pure def stepCommittedAwardPermanent(before: PrivateCase, after: PrivateCase): bool = committed(before) implies
  committed(after) and after.grossChosen == before.grossChosen and after.commitment == before.commitment
  and (before.award == Approved implies after.award == Approved)
pure def sometimesStandardApproved(c: PrivateCase): bool = c.award == Approved and c.commitment == DirectAward
pure def sometimesVaultReserved(c: PrivateCase): bool = c.award == Approved and c.commitment == VaultReservation
pure def sometimesFullAwardHeld(c: PrivateCase): bool = c.commitment == FullAwardHeld
pure def sometimesRelatedPending(c: PrivateCase): bool = c.relatedReview == ReviewPending
pure def sometimesRelatedApproved(c: PrivateCase): bool = c.relatedReview == ReviewApproved and c.award == Approved
pure def sometimesDeclined(c: PrivateCase): bool = c.award == Ineligible
pure def sometimesLegacyApproved(c: PrivateCase): bool = c.award == Approved and c.deciders.length() == 1 and c.receipt == Received
```

## Story: Appeal privately with Slopbot triage and an independent moderator

### Slopbot drafts advice for each appeal and always escalates a private case

A reporter appeals a duplicate, out-of-scope or rejected finding, or a
confirmed finding without an award. The appeal queues one Slopbot triage of
that appeal revision (`security_appeal_triages`, prompt
`slop-security-appeal-triage-1`, Surplus `claude-sonnet-5.5`). A draft is
advice only and records the escalation reason `private-security-case`, and
`confidence-below-floor` below 0.9. Failed, unavailable and lost attempts
(running for more than 15 minutes) may be retried by a moderator. A late
result of an older attempt or appeal cannot finish. The reporter's view omits
the draft.

```quint
type TriageOutcome = Drafted({ returnCase: bool, confidencePercent: int }) | TriageFailedResult | TriageUnavailableResult
pure def appealable(c: PrivateCase): bool = c.receipt == Duplicate or c.receipt == OutOfScope or c.receipt == Rejected
  or (c.receipt == Confirmed and (c.award == Ineligible or c.award == CapacityExhausted))
pure def canAppeal(c: PrivateCase, by: int): bool = c.submission == Verified and by == c.reporter and c.appeal != AppealOpen and appealable(c)
pure def appeal(c: PrivateCase, by: int): PrivateCase =
  { ...c, appeal: AppealOpen, appealFrom: c.receipt, receipt: Disputed, revision: c.revision + 1,
    triage: { ...noTriage, state: TriageQueued, appealRevision: c.revision + 1, attempt: c.triage.attempt } }
pure def canStartTriage(c: PrivateCase, nowMs: int): bool = c.appeal == AppealOpen and c.triage.state == TriageQueued and nowMs > 0
pure def startTriage(c: PrivateCase, nowMs: int): PrivateCase =
  { ...c, triage: { ...c.triage, state: TriageRunning, attempt: c.triage.attempt + 1, startedAt: nowMs } }
pure def canFinishTriage(c: PrivateCase, appealRevision: int, attempt: int, result: TriageOutcome): bool =
  c.appeal == AppealOpen and c.triage.state == TriageRunning and appealRevision == c.triage.appealRevision
    and attempt == c.triage.attempt and (match result { | Drafted(d) => d.confidencePercent >= 0 and d.confidencePercent <= 100 | _ => true })
pure def finishTriage(c: PrivateCase, appealRevision: int, attempt: int, result: TriageOutcome): PrivateCase =
  match result {
    | Drafted(d) => { ...c, triage: { ...c.triage, state: TriageComplete, escalated: true, belowFloor: d.confidencePercent < 90, returnDraft: d.returnCase } }
    | TriageFailedResult => { ...c, triage: { ...c.triage, state: TriageFailed } }
    | TriageUnavailableResult => { ...c, triage: { ...c.triage, state: TriageUnavailable } }
  }
pure def canRetryTriage(c: PrivateCase, by: int, checkedEpoch: int, nowMs: int): bool = c.appeal == AppealOpen and moderatorNow(c, by, checkedEpoch)
  and (c.triage.state == TriageFailed or c.triage.state == TriageUnavailable
    or (c.triage.state == TriageRunning and nowMs >= c.triage.startedAt and nowMs - c.triage.startedAt > 900000))
pure def retryTriage(c: PrivateCase, by: int, checkedEpoch: int, nowMs: int): PrivateCase = { ...c, triage: { ...c.triage, state: TriageQueued } }
pure def alwaysTriageEscalates(c: PrivateCase): bool = c.triage.state == TriageComplete implies c.triage.escalated
pure def alwaysTriageBoundToAppeal(c: PrivateCase): bool = c.triage.attempt >= 0 and (c.triage.state != NoTriage implies c.triage.appealRevision > 0)
  and (c.triage.state == TriageRunning implies c.triage.attempt > 0 and c.triage.startedAt > 0)
pure def stepTriageIsAdvice(before: PrivateCase, via: str, after: PrivateCase): bool =
  (via == "startTriage" or via == "finishTriage" or via == "retryTriage") implies
    after.receipt == before.receipt and after.award == before.award and after.appeal == before.appeal
    and after.grossChosen == before.grossChosen and after.revision == before.revision
pure def sometimesTriageEscalated(c: PrivateCase): bool = c.triage.state == TriageComplete and c.triage.belowFloor
pure def sometimesTriageRetried(c: PrivateCase): bool = c.triage.state == TriageRunning and c.triage.attempt > 1
```

### An independent moderator upholds or returns the appeal

A moderator decides with or without a draft. The moderator never decided this
case before, including an earlier appeal or related-party review. Upholding
restores the appealed finding. Returning reopens triage and a declined award;
a capacity wait still waits for funds. Every appeal outcome stays in history.

```quint
pure def canDecideAppeal(c: PrivateCase, by: int, checkedEpoch: int, uphold: bool): bool = c.appeal == AppealOpen
  and moderatorNow(c, by, checkedEpoch) and not(c.deciders.includes(by))
pure def decideAppeal(c: PrivateCase, by: int, checkedEpoch: int, uphold: bool): PrivateCase =
  { ...c, appeal: if (uphold) Upheld else Returned, receipt: if (uphold) c.appealFrom else Triaging,
    award: if (not(uphold) and c.award == Ineligible) Pending else c.award,
    appealHistory: c.appealHistory.append({ from: c.appealFrom, resolution: if (uphold) Upheld else Returned, by: by }),
    deciders: c.deciders.append(by), revision: c.revision + 1 }
pure def alwaysAppealState(c: PrivateCase): bool = (c.appeal == AppealOpen) == (c.receipt == Disputed)
pure def alwaysAppealSource(c: PrivateCase): bool = c.appeal == AppealOpen implies (c.appealFrom == Duplicate
  or c.appealFrom == OutOfScope or c.appealFrom == Rejected or c.appealFrom == Confirmed) and not(committed(c))
pure def stepAppealHistoryAppendOnly(before: PrivateCase, after: PrivateCase): bool =
  after.appealHistory == before.appealHistory or after.appealHistory == before.appealHistory.append(after.appealHistory.nthOr(before.appealHistory.length(), noAppealRecord))
pure def sometimesReturnedAndRedecided(c: PrivateCase): bool = c.appeal == Returned and c.receipt != Triaging
pure def sometimesSecondAppeal(c: PrivateCase): bool = c.appeal == AppealOpen and c.appealHistory.length() > 0
```

### Simulation samples cover roles, revocation, bans and every decision shape

These input sets bound simulation only. Actors 2 and 3 are technical, 4 and 7
are moderators, 5 is financial and 6 a triager candidate.

```quint
pure val staff: Authority = { epoch: 1, technical: List(2, 3), financial: List(5), moderators: List(4, 7), banned: List(),
  relatedParties: List(), programRestricted: false }
pure val snapshotValues = Set(staff, { ...staff, epoch: 2, technical: List(3) }, { ...staff, epoch: 2, relatedParties: List(1) },
  { ...staff, epoch: 3, banned: List(1) }, { ...staff, epoch: 3, programRestricted: true })
pure val byValues = Set(1, 2, 3, 4, 5, 6, 7)
pure val actorValues = Set(1, 6)
pure val checkedEpochValues = Set(1, 2, 3)
pure val sourceValues = Set(SlopReceived, GithubVerified)
pure val termsValues = Set(T::standardTerms, T::fullTerms, T::historicalTerms, T::unpaidTerms(1, 2))
pure val grossValues = Set(List(4), List(0))
pure val historyValues = Set(NewReceipt, ImportedReservation, ImportedCapacityWait)
pure val reportVersionValues = Set(1)
pure val versionValues = Set(1, 2)
pure val decisionValues = Set(
  { finding: Confirmed, severity: T::Critical, loss: T::VerifiedPotential, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: false },
  { finding: Confirmed, severity: T::High, loss: T::NotVerified, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: true },
  { finding: Rejected, severity: T::SeverityUnset, loss: T::LossUnset, inScope: false, rootCause: 0, duplicateOf: 0, declareRelated: false },
  { finding: Duplicate, severity: T::SeverityUnset, loss: T::LossUnset, inScope: true, rootCause: 1, duplicateOf: 9, declareRelated: false })
pure val clearanceValues = Set(2, 3, 4, 5).fold(Set(), (cs, revision) => cs.union(Set(
  { caseRevision: revision, firstQualifying: true, rootCauseFree: true, rail: DirectRail },
  { caseRevision: revision, firstQualifying: true, rootCauseFree: true, rail: VaultRail },
  { caseRevision: revision, firstQualifying: false, rootCauseFree: true, rail: DirectRail },
  { caseRevision: revision, firstQualifying: true, rootCauseFree: true, rail: NoRail })))
pure val nowMsValues = Set(1, 900002)
pure val appealRevisionValues = Set(2, 3, 4, 5, 6)
pure val attemptValues = Set(1, 2)
pure val resultValues = Set(Drafted({ returnCase: true, confidencePercent: 95 }), Drafted({ returnCase: false, confidencePercent: 40 }),
  TriageFailedResult, TriageUnavailableResult)
pure val weight_decide = 8
pure val weight_decideAward = 8
pure val weight_appeal = 6
pure val weight_finishTriage = 6
pure val weight_decideAppeal = 5
pure val weight_observeAuthority = 3
```

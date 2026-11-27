# Slopbot close, appeal and penalty composition

PRD sections 4, 5 and 7 and CLAUDE.md "Slopbot": automatic closure needs the
author's own authenticated run for the exact PR, a complete current review,
every closure gate on a fresh recheck and reopen protection; a debit is
recorded once per confirmed close and an upheld appeal or a maintainer
reopen reverses it once; a Scam close asks the moderators to review the
account. One instance is one decided close candidate of the
[closure decision](./closure.md) and holds, written together, its
[close attempt](./closeAttempt.md), the [review claim](./reviewLease.md) of
its review key, the author's [pull_request_opened run](../contributor/prOpened.md),
the [appeal](./appeals.md) of the revision, the item's [penalty journal](../points/penalties.md)
and the reopen source the [webhook](./webhookDelivery.md) retained.

Each composed event calls a child transition only under that child's guard,
so every child rule holds of its part. The capacity grant comes from
[close capacity](./closeCapacity.md) and the moderator rows from
[moderation](../operations/moderation.md), keyed by the closed item. Senders:
the author's and other members' GitHub IDs, `slopbotWorker` (the review
worker and scheduled jobs) and `githubWebhook` (GitHub's verified close,
refusal, reopen and item reads).

## Story: Close only from a complete current review under the live claim

### The recheck's participation evidence is derived from the author's recorded opened event

The author registers the `pr_opened` run and records the event through the
authenticated session. The participation evidence a recheck carries is
computed from that run alone: a membership read, the run's actor and a
recorded event for the exact project, repository and PR node. The lease
evidence of a recheck is the live review claim.

```quint
import categories as F from "./categories"
import closure as C from "./closure"
import closeAttempt as CA from "./closeAttempt"
import reviewLease as L from "./reviewLease"
import routing as R from "./routing"
import appeals as A from "./appeals"
import webhookDelivery as W from "./webhookDelivery"
import penalties as P from "../points/penalties"
import prOpened as PO from "../contributor/prOpened"
type Slopbot = { attempt: CA::CloseAttempt, lease: L::ReviewLease, opened: PO::OpenedRun, appeal: A::Appeal,
  penalties: P::Penalties, retained: W::ReopenSource, repositoryName: str, now: int, confirmedReopen: bool }
pure val slopbotWorker = -10
pure val githubWebhook = -11
pure val initial: Slopbot = { attempt: { ...CA::initial, recheck: { ...CA::initial.recheck,
    gate: { ...CA::initial.recheck.gate, participation: C::noParticipation } } },
  lease: L::initial, opened: PO::initial, appeal: A::initial, penalties: P::initial, retained: W::noReopen,
  repositoryName: "o/r", now: 1, confirmedReopen: false }
pure def subjectItem(c: Slopbot): C::ReviewIdentity = c.attempt.candidate.identity
pure def proven(c: Slopbot): bool =
  PO::participationProof(c.opened, subjectItem(c).author, subjectItem(c).project, c.repositoryName, subjectItem(c).itemNode)
pure def participationFrom(c: Slopbot, membership: C::Membership): C::ParticipationEvidence =
  { member: c.opened.actor, membership: membership, copiedMarker: false,
    events: if (proven(c)) List({ actor: c.opened.actor, sessionActor: c.opened.actor, project: c.opened.project,
      repository: subjectItem(c).repository, prNode: c.opened.prNode }) else List() }
pure def leaseView(lease: L::ReviewLease): CA::LeaseView =
  { token: lease.token, running: lease.status == L::Running, expiresAt: lease.expires, observedAt: lease.now }
pure def composedRecheck(c: Slopbot, recheck: CA::Recheck): CA::Recheck =
  { gate: { ...recheck.gate, participation: participationFrom(c, recheck.gate.participation.membership) },
    fence: recheck.fence, lease: leaseView(c.lease) }
pure def canRegisterRun(c: Slopbot, by: int, serverRun: str): bool =
  PO::canRegister(c.opened, by, subjectItem(c).project, c.repositoryName, subjectItem(c).itemNode, serverRun, subjectItem(c).author)
pure def registerRun(c: Slopbot, by: int, serverRun: str): Slopbot =
  { ...c, opened: PO::register(c.opened, by, subjectItem(c).project, c.repositoryName, subjectItem(c).itemNode, serverRun,
    subjectItem(c).author) }
pure def canRecordOpened(c: Slopbot, by: int, at: int): bool = PO::canRecord(c.opened, by, subjectItem(c).itemNode, at)
pure def recordOpened(c: Slopbot, by: int, at: int): Slopbot = { ...c, opened: PO::record(c.opened, by, subjectItem(c).itemNode, at) }
pure def canObserveRecheck(c: Slopbot, by: int, recheck: CA::Recheck): bool =
  by == slopbotWorker and CA::canObserveRecheck(c.attempt, composedRecheck(c, recheck))
pure def observeRecheck(c: Slopbot, by: int, recheck: CA::Recheck): Slopbot =
  { ...c, attempt: CA::observeRecheck(c.attempt, composedRecheck(c, recheck)) }
pure def alwaysParticipationFromOpenedRun(c: Slopbot): bool =
  C::participationAuthority(c.attempt.recheck.gate.participation, subjectItem(c)) implies proven(c)
pure def stepParticipationKept(before: Slopbot, after: Slopbot): bool = proven(before) implies proven(after)
pure def sometimesParticipationProven(c: Slopbot): bool =
  C::participationAuthority(c.attempt.recheck.gate.participation, subjectItem(c))
```

### The review claim tracks the close attempt, sends only under its live owner and completes only after the close settles

The claim records a pending close in the same write as the reservation and
its confirmation or rejection in the same write as GitHub's evidence. The
close request needs the reserving claim to be the live owner and the recheck
to show complete coverage. The review completes only after its close
settles.

```quint
pure def canObserveTime(c: Slopbot, by: int, time: int): bool =
  by == slopbotWorker and time >= c.now and L::canObserveTime(c.lease, time) and A::canObserveTime(c.appeal, time)
pure def observeTime(c: Slopbot, by: int, time: int): Slopbot =
  { ...c, now: time, lease: L::observeTime(c.lease, time), appeal: A::observeTime(c.appeal, time) }
pure def canClaimReview(c: Slopbot, by: int, token: int, expires: int, slots: R::AuthorSlots, route: R::Route): bool =
  by == slopbotWorker and L::canClaim(c.lease, token, expires, slots, route)
pure def claimReview(c: Slopbot, by: int, token: int, expires: int, slots: R::AuthorSlots, route: R::Route): Slopbot =
  { ...c, lease: L::claim(c.lease, token, expires, slots, route) }
pure def canFinishReview(c: Slopbot, by: int, token: int, claimStatus: L::ClaimStatus): bool =
  by == slopbotWorker and L::canFinish(c.lease, token, claimStatus)
pure def finishReview(c: Slopbot, by: int, token: int, claimStatus: L::ClaimStatus): Slopbot =
  { ...c, lease: L::finish(c.lease, token, claimStatus) }
pure def canReserveClose(c: Slopbot, by: int, grant: CA::CapacityGrant): bool =
  by == slopbotWorker and CA::canReserveClose(c.attempt, grant) and L::canObserveClose(c.lease, L::PendingClose)
pure def reserveClose(c: Slopbot, by: int, grant: CA::CapacityGrant): Slopbot =
  { ...c, attempt: CA::reserveClose(c.attempt, grant), lease: L::observeClose(c.lease, L::PendingClose) }
pure def canRequestClose(c: Slopbot, by: int): bool =
  by == slopbotWorker and CA::canRequestClose(c.attempt) and L::ownsClaim(c.lease, c.attempt.attempt.leaseToken)
pure def requestClose(c: Slopbot, by: int): Slopbot = { ...c, attempt: CA::requestClose(c.attempt) }
pure def canRejectClose(c: Slopbot, by: int, githubRefusal: CA::GithubRefusal): bool =
  by == githubWebhook and CA::canRejectClose(c.attempt, githubRefusal) and L::canObserveClose(c.lease, L::RejectedClose)
pure def rejectClose(c: Slopbot, by: int, githubRefusal: CA::GithubRefusal): Slopbot =
  { ...c, attempt: CA::rejectClose(c.attempt, githubRefusal), lease: L::observeClose(c.lease, L::RejectedClose) }
pure def alwaysClaimTracksAttempt(c: Slopbot): bool =
  ((c.attempt.attempt.state == CA::Pending) iff (c.lease.close == L::PendingClose)) and
  ((c.attempt.attempt.state == CA::Confirmed) iff (c.lease.close == L::ConfirmedClose))
pure def stepCloseSentByLiveOwnerOnCompleteReview(before: Slopbot, via: str, after: Slopbot): bool =
  via == "requestClose" implies (L::ownsClaim(before.lease, before.attempt.attempt.leaseToken) and
    before.attempt.recheck.gate.source.coverage == C::CoverageComplete and
    C::closeGatesFor(before.attempt.recheck.gate, subjectItem(before), before.attempt.candidate.triage,
      before.attempt.candidate.confirm))
pure def alwaysCompletedReviewSettledItsClose(c: Slopbot): bool =
  c.lease.status == L::Completed implies c.attempt.attempt.state != CA::Pending
pure def sometimesReviewCompletedAfterClose(c: Slopbot): bool =
  c.lease.status == L::Completed and c.attempt.attempt.state == CA::Confirmed
```

## Story: A confirmed close debits once, and a reopen or upheld appeal reverses it once

### A debit is written only by the confirmed close, keyed by the PR, never by a retry, reopen or appeal

GitHub's close event confirms the attempt and, in the same write, records
the penalty of the closed category for the author in the month of
`closed_at`, unless a maintainer reopen of the revision was confirmed first.
A close confirmed after the appeal was upheld is reversed in the same write.
Nothing else writes a penalty row.

```quint
pure val monthSeconds = 2678400
pure def confirmedClose(c: Slopbot, closeEvent: CA::CloseEvidence): P::ConfirmedClose =
  { item: subjectItem(c).itemNode, repository: subjectItem(c).repository, revision: subjectItem(c).revision,
    author: subjectItem(c).author, project: subjectItem(c).project,
    category: c.attempt.candidate.triage.verdict.category, closedAt: closeEvent.closedAt,
    period: closeEvent.closedAt / monthSeconds + 1 }
pure def authority(c: Slopbot, at: int, reason: P::ReversalReason): P::ReversalAuthority =
  { item: subjectItem(c).itemNode, revision: subjectItem(c).revision, at: at, reason: reason }
pure def reverseIfDue(p: P::Penalties, reversal: P::ReversalAuthority): P::Penalties =
  if (P::canReversePenalty(p, reversal)) P::reversePenalty(p, reversal) else p
pure def canConfirmClose(c: Slopbot, by: int, closeEvent: CA::CloseEvidence): bool =
  by == githubWebhook and CA::canConfirmClose(c.attempt, closeEvent) and L::canObserveClose(c.lease, L::ConfirmedClose)
pure def confirmClose(c: Slopbot, by: int, closeEvent: CA::CloseEvidence): Slopbot =
  val confirmed = confirmedClose(c, closeEvent)
  val recorded = if (P::canRecordPenalty(c.penalties, confirmed)) P::recordPenalty(c.penalties, confirmed) else c.penalties
  { ...c, attempt: CA::confirmClose(c.attempt, closeEvent), lease: L::observeClose(c.lease, L::ConfirmedClose),
    penalties: if (c.appeal.resolution == A::Upheld) reverseIfDue(recorded, authority(c, c.now, P::AppealUpheld)) else recorded }
pure def canConfirmCloseComment(c: Slopbot, by: int): bool = by == slopbotWorker and CA::canConfirmCloseComment(c.attempt)
pure def confirmCloseComment(c: Slopbot, by: int): Slopbot = { ...c, attempt: CA::confirmCloseComment(c.attempt) }
pure def alwaysDebitOnlyFromConfirmedClose(c: Slopbot): bool =
  c.penalties.credits.length() == 0 and c.penalties.rows.length() <= 1 and
  c.penalties.rows.every(r => r.item == subjectItem(c).itemNode and r.revision == subjectItem(c).revision and
    r.bucket.actor == subjectItem(c).author and r.bucket.project == subjectItem(c).project and
    r.category == c.attempt.candidate.triage.verdict.category) and
  (c.penalties.rows.length() > 0 implies c.attempt.attempt.state == CA::Confirmed)
pure def stepDebitRowsKept(before: Slopbot, after: Slopbot): bool =
  before.penalties.rows.every(r => after.penalties.rows.some(x => P::sameDebit(x, r) and (r.reversed implies x == r)))
pure def sometimesScamDebitedAndNotified(c: Slopbot): bool =
  c.penalties.rows.some(r => not(r.reversed)) and c.attempt.moderatorNotices.size() > 0
```

### A confirmed maintainer reopen from the retained webhook source marks the attempt reopened, records the reopen and reverses the debit

The webhook retains one validated reopen source of the item. A downstream
decision from that source and a fresh observation is a maintainer decision
only for a verified current maintainer on the exact node; it marks the close
attempt reopened, records the confirmed reopen in the penalty journal,
reverses a debit of that revision and resolves an open appeal as upheld, all
in one write.

```quint
pure def canRetainReopen(c: Slopbot, by: int, source: W::ReopenSource): bool =
  by == githubWebhook and W::validReopen(source) and c.retained == W::noReopen and
  source.node == subjectItem(c).itemNode and source.repository == subjectItem(c).repository
pure def retainReopen(c: Slopbot, by: int, source: W::ReopenSource): Slopbot = { ...c, retained: source }
pure def decisionOf(c: Slopbot, evidence: W::ReopenObservation): W::ReopenDecision =
  W::reopenDecision(evidence, { ...W::initial, reopen: c.retained })
pure def maintainerReopenEvidence(c: Slopbot): C::ReopenEvidence =
  { itemNode: c.retained.node, revision: c.retained.revision, actor: c.retained.sender, role: C::ReopenByMaintainer,
    at: c.retained.occurred }
pure def canConfirmReopen(c: Slopbot, by: int, evidence: W::ReopenObservation): bool =
  by == slopbotWorker and not(c.confirmedReopen) and decisionOf(c, evidence) == W::MaintainerDecision and
  CA::canObserveReopen(c.attempt, maintainerReopenEvidence(c)) and
  P::canConfirmReopen(c.penalties, { item: c.retained.node, revision: c.retained.revision, at: c.retained.occurred,
    actor: c.retained.sender, role: P::VerifiedMaintainer })
pure def confirmReopen(c: Slopbot, by: int, evidence: W::ReopenObservation): Slopbot =
  val recorded = P::confirmReopen(c.penalties, { item: c.retained.node, revision: c.retained.revision,
    at: c.retained.occurred, actor: c.retained.sender, role: P::VerifiedMaintainer })
  val decision: A::ReopenRecord = { item: c.retained.node, revision: c.retained.revision, actor: c.retained.sender,
    role: A::CurrentMaintainer }
  { ...c, confirmedReopen: true, attempt: CA::observeReopen(c.attempt, maintainerReopenEvidence(c)),
    penalties: reverseIfDue(recorded, { item: c.retained.node, revision: c.retained.revision, at: c.retained.occurred,
      reason: P::MaintainerReopen }),
    appeal: if (A::canMaintainerReopen(c.appeal, decision)) A::maintainerReopen(c.appeal, decision) else c.appeal }
pure def alwaysConfirmedReopenRecorded(c: Slopbot): bool = c.confirmedReopen implies
  (c.attempt.maintainerReopened and c.retained.node == subjectItem(c).itemNode and
   c.retained.revision == subjectItem(c).revision and
   P::reopenedRevision(c.penalties, subjectItem(c).itemNode, c.retained.revision))
pure def alwaysRetainedSourceIsTheItem(c: Slopbot): bool = c.retained != W::noReopen implies
  (W::validReopen(c.retained) and c.retained.node == subjectItem(c).itemNode and c.retained.repository == subjectItem(c).repository)
pure def sometimesReopenReversedDebit(c: Slopbot): bool =
  c.confirmedReopen and c.penalties.rows.some(r => r.reversed and r.reason == P::MaintainerReopen)
```

### The author's appeal is triaged and decided once; an upheld appeal reverses the debit and reopens only Slopbot's own close

The author's appeal opens on the revision's current debit and stops any
further reservation or request in the same write. Triage reads the
appellant's ban and the item's sibling appeals before it escalates. A Scam
finding always escalates to a moderator, who decides it. An upheld appeal reverses the
debit of the revision once and lets Slopbot reopen the item only while a
fresh read shows Slopbot's own close. The observed clock stays positive so
reversal timestamps are always valid.

```quint
pure def currentDebit(c: Slopbot): int =
  c.penalties.rows.foldl(0, (acc, r) => if (not(r.reversed)) r.debit else acc)
pure def subjectOf(c: Slopbot): A::AppealSubject =
  { item: subjectItem(c).itemNode, revision: subjectItem(c).revision, author: subjectItem(c).author,
    category: c.attempt.candidate.triage.verdict.category, tableVersion: F::currentTableVersion,
    debit: currentDebit(c), scope: A::ScopeActive }
pure def canOpenAppeal(c: Slopbot, by: int): bool =
  A::canOpen(c.appeal, by, subjectOf(c)) and CA::canObserveAuthorAppeal(c.attempt, by)
pure def openAppeal(c: Slopbot, by: int): Slopbot =
  { ...c, appeal: A::open(c.appeal, by, subjectOf(c)), attempt: CA::observeAuthorAppeal(c.attempt, by) }
pure def canDraftAppeal(c: Slopbot, by: int, uphold: bool, confidenceHundredths: int): bool =
  by == slopbotWorker and A::canDraft(c.appeal, uphold, confidenceHundredths)
pure def draftAppeal(c: Slopbot, by: int, uphold: bool, confidenceHundredths: int): Slopbot =
  { ...c, appeal: A::draft(c.appeal, uphold, confidenceHundredths) }
pure def canObserveBan(c: Slopbot, by: int, ban: A::BanStatus): bool = by == slopbotWorker and A::canObserveBan(c.appeal, ban)
pure def observeBan(c: Slopbot, by: int, ban: A::BanStatus): Slopbot = { ...c, appeal: A::observeBan(c.appeal, ban) }
pure def canObserveSibling(c: Slopbot, by: int, siblingStatus: A::SiblingStatus): bool =
  by == slopbotWorker and A::canObserveSibling(c.appeal, siblingStatus)
pure def observeSibling(c: Slopbot, by: int, siblingStatus: A::SiblingStatus): Slopbot =
  { ...c, appeal: A::observeSibling(c.appeal, siblingStatus) }
pure def canEscalateAppeal(c: Slopbot, by: int): bool = by == slopbotWorker and A::canEscalateByCriteria(c.appeal)
pure def escalateAppeal(c: Slopbot, by: int): Slopbot = { ...c, appeal: A::escalateByCriteria(c.appeal) }
pure def canDecideAppeal(c: Slopbot, by: int, uphold: bool): bool = A::canModeratorDecide(c.appeal, by, uphold)
pure def decideAppeal(c: Slopbot, by: int, uphold: bool): Slopbot =
  val upheldOutcome: C::AppealOutcome = { itemNode: subjectItem(c).itemNode, revision: subjectItem(c).revision,
    verdict: C::AppealUpheld }
  if (not(uphold)) { ...c, appeal: A::moderatorDecide(c.appeal, by, uphold) }
  else { ...c, appeal: A::moderatorDecide(c.appeal, by, uphold),
    penalties: reverseIfDue(c.penalties, authority(c, c.now, P::AppealUpheld)),
    attempt: if (CA::canObserveAppealOutcome(c.attempt, upheldOutcome)) CA::observeAppealOutcome(c.attempt, upheldOutcome) else c.attempt }
pure def alwaysUpheldOrReopenedLeavesNoDebit(c: Slopbot): bool =
  c.now > 0 and
  ((c.appeal.resolution == A::Upheld or c.confirmedReopen) implies c.penalties.rows.every(r => r.reversed))
pure def alwaysAppealOnTheRevision(c: Slopbot): bool = c.appeal.opened implies
  (c.appeal.subject.item == subjectItem(c).itemNode and c.appeal.subject.revision == subjectItem(c).revision and
   c.attempt.authorAppealed)
pure def alwaysUpheldAppealSeenByAttempt(c: Slopbot): bool =
  (c.appeal.resolution == A::Upheld and c.appeal.via == A::ModeratorDecision) implies c.attempt.appealUpheld
pure def sometimesUpheldAppealReopened(c: Slopbot): bool =
  c.appeal.resolution == A::Upheld and c.attempt.slopbotReopened and c.penalties.rows.some(r => r.reversed)
pure def sometimesDeniedAppealKeepsDebit(c: Slopbot): bool =
  c.appeal.resolution == A::Denied and c.penalties.rows.some(r => not(r.reversed))
```

### Slopbot reopens only its own current close, and a Scam close asks each moderator once

```quint
pure def canObserveItem(c: Slopbot, by: int, itemState: CA::CurrentItemState): bool =
  by == githubWebhook and CA::canObserveItem(c.attempt, itemState)
pure def observeItem(c: Slopbot, by: int, itemState: CA::CurrentItemState): Slopbot =
  { ...c, attempt: CA::observeItem(c.attempt, itemState) }
pure def canReopenOwnClose(c: Slopbot, by: int): bool = by == slopbotWorker and CA::canReopenOwnClose(c.attempt)
pure def reopenOwnClose(c: Slopbot, by: int): Slopbot = { ...c, attempt: CA::reopenOwnClose(c.attempt) }
pure def canNotifyModerator(c: Slopbot, by: int, recipient: int): bool =
  by == slopbotWorker and CA::canNotifyModerator(c.attempt, recipient) and c.penalties.rows.some(r => r.moderatorReview)
pure def notifyModerator(c: Slopbot, by: int, recipient: int): Slopbot =
  { ...c, attempt: CA::notifyModerator(c.attempt, recipient) }
pure def alwaysSlopbotReopensOnlyOwnClose(c: Slopbot): bool = c.attempt.slopbotReopened implies
  (c.attempt.attempt.state == CA::Confirmed and (c.attempt.maintainerReopened or c.attempt.appealUpheld))
pure def alwaysScamNoticesOnce(c: Slopbot): bool =
  c.attempt.moderatorNotices.subseteq(CA::slopModerators) and
  (c.attempt.moderatorNotices.size() > 0 implies
    (c.attempt.attempt.state == CA::Confirmed and c.attempt.candidate.triage.verdict.category == F::Scam and
     c.penalties.rows.some(r => r.moderatorReview)))
```

### Simulation samples follow one Scam candidate from the opened run to reversal

```quint
pure val byValues = Set(5, 6, 18633264, slopbotWorker, githubWebhook)
pure val serverRunValues = Set("run-a")
pure val atValues = Set(1)
pure val timeValues = Set(1, 2, 3)
pure val tokenValues = Set(1, 2)
pure val expiresValues = Set(4, 5)
pure val slotsValues = Set(R::initial)
pure val routeValues = Set(R::AdvisoryReview)
pure val claimStatusValues = Set(L::Completed, L::Failed)
pure val recheckValues = Set({ gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease },
  { gate: { ...CA::scamGate, seq: 3 }, fence: CA::currentFence, lease: CA::noLease },
  { gate: { ...CA::scamGate, seq: 3, source: { ...C::verifiedSource, coverage: C::CoverageLimited } },
    fence: CA::currentFence, lease: CA::noLease })
pure val grantValues = Set({ repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: CA::currentFence,
  leaseToken: 1, observedSeq: 2 }, { repository: 7, itemNode: "pr", revision: "head", attemptId: 2, fence: CA::currentFence,
  leaseToken: 2, observedSeq: 3 })
pure val githubRefusalValues = Set({ attemptId: 1, status: 422 })
pure val closeEventValues = Set({ itemNode: "pr", revision: "head", closedBy: CA::SlopbotApp, closedAt: 100 })
pure val recipientValues = Set(18633264, 202660855)
pure val maintainerReopen: W::ReopenSource = { installation: 1, repository: 7, kind: W::PullItem, number: 3, sender: 9,
  node: "pr", revision: "head", occurred: 50 }
pure val sourceValues = Set(maintainerReopen)
pure val evidenceValues = Set({ source: maintainerReopen, node: "pr", currentRevision: "head", author: 5,
  itemState: W::ClosedByBot, maintainer: true, existingDebit: true, reversalOnly: false },
  { source: maintainerReopen, node: "pr", currentRevision: "head", author: 5, itemState: W::ClosedByBot, maintainer: false,
    existingDebit: true, reversalOnly: false })
pure val confidenceHundredthsValues = Set(95)
pure val banValues = Set(A::NotBanned)
pure val siblingStatusValues = Set(A::NoSiblingHold)
pure val itemStateValues = Set({ seq: 1, itemNode: "pr", revision: "head", item: C::ItemClosed, closedBy: C::ClosedBySlopbot,
  installation: C::InstallationActive }, { seq: 2, itemNode: "pr", revision: "head", item: C::ItemClosed,
  closedBy: C::ClosedByHuman, installation: C::InstallationActive })
pure val weight_registerRun = 2
pure val weight_recordOpened = 2
pure val weight_claimReview = 2
pure val weight_observeRecheck = 2
pure val weight_reserveClose = 3
pure val weight_requestClose = 3
pure val weight_confirmClose = 3
pure val weight_notifyModerator = 2
pure val weight_openAppeal = 2
pure val weight_draftAppeal = 2
pure val weight_observeBan = 2
pure val weight_observeSibling = 2
pure val weight_escalateAppeal = 2
pure val weight_decideAppeal = 2
pure val weight_observeItem = 2
pure val weight_reopenOwnClose = 2
pure val eval_witness_sometimesParticipationProven = (
  ("registerRun", 5, "run-a"),
  ("recordOpened", 5, 1),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease }))
pure val eval_witness_sometimesReviewCompletedAfterClose = (
  ("registerRun", 5, "run-a"),
  ("recordOpened", 5, 1),
  ("observeTime", slopbotWorker, 2),
  ("claimReview", slopbotWorker, 1, 4, R::initial, R::AdvisoryReview),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease }),
  ("reserveClose", slopbotWorker, { repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: CA::currentFence, leaseToken: 1, observedSeq: 2 }),
  ("requestClose", slopbotWorker),
  ("rejectClose", githubWebhook, { attemptId: 1, status: 422 }),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 3 }, fence: CA::currentFence, lease: CA::noLease }),
  ("reserveClose", slopbotWorker, { repository: 7, itemNode: "pr", revision: "head", attemptId: 2, fence: CA::currentFence, leaseToken: 1, observedSeq: 3 }),
  ("requestClose", slopbotWorker),
  ("confirmClose", githubWebhook, { itemNode: "pr", revision: "head", closedBy: CA::SlopbotApp, closedAt: 100 }),
  ("confirmCloseComment", slopbotWorker),
  ("finishReview", slopbotWorker, 1, L::Completed))
pure val eval_witness_sometimesScamDebitedAndNotified = (
  ("registerRun", 5, "run-a"),
  ("recordOpened", 5, 1),
  ("claimReview", slopbotWorker, 1, 4, R::initial, R::AdvisoryReview),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease }),
  ("reserveClose", slopbotWorker, { repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: CA::currentFence, leaseToken: 1, observedSeq: 2 }),
  ("requestClose", slopbotWorker),
  ("confirmClose", githubWebhook, { itemNode: "pr", revision: "head", closedBy: CA::SlopbotApp, closedAt: 100 }),
  ("notifyModerator", slopbotWorker, 18633264))
pure val eval_witness_sometimesReopenReversedDebit = (
  ("registerRun", 5, "run-a"),
  ("recordOpened", 5, 1),
  ("claimReview", slopbotWorker, 1, 4, R::initial, R::AdvisoryReview),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease }),
  ("reserveClose", slopbotWorker, { repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: CA::currentFence, leaseToken: 1, observedSeq: 2 }),
  ("requestClose", slopbotWorker),
  ("confirmClose", githubWebhook, { itemNode: "pr", revision: "head", closedBy: CA::SlopbotApp, closedAt: 100 }),
  ("retainReopen", githubWebhook, maintainerReopen),
  ("confirmReopen", slopbotWorker, { source: maintainerReopen, node: "pr", currentRevision: "head", author: 5, itemState: W::ClosedByBot, maintainer: true, existingDebit: true, reversalOnly: false }))
pure val eval_witness_sometimesDeniedAppealKeepsDebit = (
  ("registerRun", 5, "run-a"),
  ("recordOpened", 5, 1),
  ("claimReview", slopbotWorker, 1, 4, R::initial, R::AdvisoryReview),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease }),
  ("reserveClose", slopbotWorker, { repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: CA::currentFence, leaseToken: 1, observedSeq: 2 }),
  ("requestClose", slopbotWorker),
  ("confirmClose", githubWebhook, { itemNode: "pr", revision: "head", closedBy: CA::SlopbotApp, closedAt: 100 }),
  ("openAppeal", 5),
  ("draftAppeal", slopbotWorker, false, 95),
  ("observeBan", slopbotWorker, A::NotBanned),
  ("observeSibling", slopbotWorker, A::NoSiblingHold),
  ("escalateAppeal", slopbotWorker),
  ("decideAppeal", 18633264, false))
pure val eval_witness_sometimesUpheldAppealReopened = (
  ("registerRun", 5, "run-a"),
  ("recordOpened", 5, 1),
  ("claimReview", slopbotWorker, 1, 4, R::initial, R::AdvisoryReview),
  ("observeRecheck", slopbotWorker, { gate: { ...CA::scamGate, seq: 2 }, fence: CA::currentFence, lease: CA::noLease }),
  ("reserveClose", slopbotWorker, { repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: CA::currentFence, leaseToken: 1, observedSeq: 2 }),
  ("requestClose", slopbotWorker),
  ("confirmClose", githubWebhook, { itemNode: "pr", revision: "head", closedBy: CA::SlopbotApp, closedAt: 100 }),
  ("openAppeal", 5),
  ("draftAppeal", slopbotWorker, true, 95),
  ("observeBan", slopbotWorker, A::NotBanned),
  ("observeSibling", slopbotWorker, A::NoSiblingHold),
  ("escalateAppeal", slopbotWorker),
  ("decideAppeal", 18633264, true),
  ("observeItem", githubWebhook, { seq: 1, itemNode: "pr", revision: "head", item: C::ItemClosed, closedBy: C::ClosedBySlopbot, installation: C::InstallationActive }),
  ("reopenOwnClose", slopbotWorker))
```

# Close attempts

PRD section 5 (caps, reopen protection, appeals, explicit production
activation), section 7 (a debit only for a confirmed close, never multiplied
by retry) and CLAUDE.md "Automatic closure". Source
`workers/slopbot/review.ts` (`runReview` after the close decision,
`stillMayClose`, the pending-close recovery, `reconcileConfirmedReopen`,
`notifyScamReviewForPenalty`), `close-attempts.ts` (`reserveClose`,
`confirmClose`, `rejectClose`, `confirmCloseComment`),
`value-publication-fence.ts` and migration `0117`.

One instance is one item revision that [the closure decision](./closure.md)
recorded as a close candidate. It starts from that decision (its identity,
both assessed verdicts and the observation sequence it was decided on) and
owns the close attempt journal, the comment update that replaces a blocked close, the
moderator notices of a confirmed scam close and Slopbot's reopen of its own
close. Its inputs are typed observations from named verified services:

| Observation | Verified by |
|---|---|
| `Recheck.gate` | the same gate reader as the decision (`closure.md`), read again with a larger sequence number |
| `Recheck.fence` | the projects registry row read for the value publication fence: project, approved revision, manifest digest and `project_enforcements` journal position |
| `Recheck.lease` | the review claim row (`slopbot_reviews.claim_token`, `status`, `lease_expires_at`) read with the trusted clock |
| `CapacityGrant`, `CapacityRefusal` | [close capacity](./closeCapacity.md), which admits or refuses the reservation in one D1 write |
| `CloseEvidence`, `GithubRefusal` | GitHub's close event with its actor and `closed_at`, and the response status of the close request |
| `ReopenEvidence`, `CurrentItemState`, `RemovalEvidence` | GitHub's reopen event with the actor's verified role, a fresh item read, and the label read |
| `AppealOutcome` | appeals (`appeals.md`) |

Creating an instance only from a decided close candidate, and binding the
grant and refusal to the capacity machine's own reservation, are composition
obligations.

## Story: Recheck every gate before the slot is reserved and the request is sent

### A reservation needs a later recheck than the decision, the current fence and the review lease

A close candidate reserves its repository slot only with a gate observation
taken after the decision. Every closure gate holds on that observation, the
revision is not disputed, the fence names the decided project and its current
approved revision, and the worker still holds an unexpired review lease. The
capacity grant must cite that same observation, fence and lease token, so a
stale switch, consent or registry read can never authorize a reservation.

```quint
import categories as F from "./categories"
import closure as C from "./closure"
type Candidate = { identity: C::ReviewIdentity, triage: C::AssessedVerdict, confirm: C::AssessedVerdict, decidedSeq: int }
type ProjectFence = { project: int, projectRevision: int, manifestDigest: str, enforcementPosition: int }
type LeaseView = { token: int, running: bool, expiresAt: int, observedAt: int }
type Recheck = { gate: C::GateObservation, fence: ProjectFence, lease: LeaseView }
type CapacityGrant = { repository: int, itemNode: str, revision: str, attemptId: int, fence: ProjectFence,
  leaseToken: int, observedSeq: int }
type AttemptState = NoAttempt | Pending | Confirmed
type Attempt = { state: AttemptState, id: int, requests: int, closedAt: int, commentConfirmed: bool,
  leaseToken: int, fence: ProjectFence, reservedSeq: int }
type BlockReason = NotBlocked | GatesChanged | CapacityRefused
type CloseAttempt = { candidate: Candidate, recheck: Recheck, attempt: Attempt, rejected: List[int],
  blocked: BlockReason, blockedCommented: bool, moderatorNotices: Set[int], moderatorLabel: bool,
  maintainerReopened: bool, authorAppealed: bool, appealUpheld: bool, itemNow: CurrentItemState,
  slopbotReopened: bool }
pure val noFence: ProjectFence = { project: 0, projectRevision: 0, manifestDigest: "", enforcementPosition: 0 }
pure val noLease: LeaseView = { token: 0, running: false, expiresAt: 0, observedAt: 0 }
pure val noAttempt: Attempt = { state: NoAttempt, id: 0, requests: 0, closedAt: 0, commentConfirmed: false,
  leaseToken: 0, fence: noFence, reservedSeq: 0 }
pure def leaseHeld(lease: LeaseView): bool = lease.token > 0 and lease.running and lease.observedAt < lease.expiresAt
pure def fenceMatches(fence: ProjectFence, gate: C::GateObservation, identity: C::ReviewIdentity): bool =
  fence.project == identity.project and fence.projectRevision == gate.source.projectRevision and
  fence.projectRevision > 0 and fence.manifestDigest != "" and fence.enforcementPosition >= 0
pure def disputed(c: CloseAttempt): bool = c.maintainerReopened or c.authorAppealed or c.appealUpheld
pure def freshAfterDecision(c: CloseAttempt): bool = c.recheck.gate.seq > c.candidate.decidedSeq
pure def gatesCurrent(c: CloseAttempt): bool = freshAfterDecision(c) and not(disputed(c)) and
  C::closeGatesFor(c.recheck.gate, c.candidate.identity, c.candidate.triage, c.candidate.confirm) and
  fenceMatches(c.recheck.fence, c.recheck.gate, c.candidate.identity)
pure def mayReserve(c: CloseAttempt): bool = gatesCurrent(c) and leaseHeld(c.recheck.lease)
pure def canObserveRecheck(c: CloseAttempt, recheck: Recheck): bool =
  recheck.gate.seq > c.recheck.gate.seq and recheck.gate.source.identity == c.candidate.identity
pure def observeRecheck(c: CloseAttempt, recheck: Recheck): CloseAttempt = { ...c, recheck: recheck }
pure def grantMatches(c: CloseAttempt, grant: CapacityGrant): bool =
  grant.repository == c.candidate.identity.repository and grant.itemNode == c.candidate.identity.itemNode and
  grant.revision == c.candidate.identity.revision and grant.fence == c.recheck.fence and
  grant.leaseToken == c.recheck.lease.token and grant.observedSeq == c.recheck.gate.seq
pure def canReserveClose(c: CloseAttempt, grant: CapacityGrant): bool =
  c.attempt.state == NoAttempt and c.blocked == NotBlocked and mayReserve(c) and grantMatches(c, grant) and
  grant.attemptId > 0 and grant.attemptId > c.attempt.id and c.rejected.every(r => r < grant.attemptId)
pure def reserveClose(c: CloseAttempt, grant: CapacityGrant): CloseAttempt =
  { ...c, attempt: { state: Pending, id: grant.attemptId, requests: 0, closedAt: 0, commentConfirmed: false,
    leaseToken: grant.leaseToken, fence: grant.fence, reservedSeq: grant.observedSeq } }
pure def stepReserveOnlyAfterFreshRecheck(before: CloseAttempt, via: str, after: CloseAttempt): bool =
  via == "reserveClose" implies mayReserve(before) and after.attempt.reservedSeq > before.candidate.decidedSeq
```

### The request is sent at most once, by the reserving lease, on the reservation's recheck or a later one

The GitHub close request uses an observation at least as new as the
reservation's, on which every gate still holds, under the reserving lease and
fence. A worker that lost its lease never sends it; the attempt stays pending
and a later claim may only reconcile it. The request is marked before it is
sent, so a replay never sends a second close for the attempt.

```quint
pure def canRequestClose(c: CloseAttempt): bool =
  c.attempt.state == Pending and c.attempt.requests == 0 and gatesCurrent(c) and
  c.recheck.gate.seq >= c.attempt.reservedSeq and leaseHeld(c.recheck.lease) and
  c.recheck.lease.token == c.attempt.leaseToken and c.recheck.fence == c.attempt.fence
pure def requestClose(c: CloseAttempt): CloseAttempt = { ...c, attempt: { ...c.attempt, requests: 1 } }
pure def alwaysAtMostOneRequest(c: CloseAttempt): bool = c.attempt.requests >= 0 and c.attempt.requests <= 1 and
  (c.attempt.state == NoAttempt implies c.attempt == noAttempt)
pure def alwaysAttemptBoundToReservation(c: CloseAttempt): bool = c.attempt.state != NoAttempt implies
  c.attempt.id > 0 and c.attempt.leaseToken > 0 and c.attempt.reservedSeq > c.candidate.decidedSeq and
  c.attempt.fence.project == c.candidate.identity.project and c.attempt.fence.projectRevision > 0 and
  c.recheck.gate.seq >= c.attempt.reservedSeq
pure def stepRequestOnlyByReservingLease(before: CloseAttempt, via: str, after: CloseAttempt): bool =
  via == "requestClose" implies gatesCurrent(before) and leaseHeld(before.recheck.lease) and
    before.recheck.lease.token == before.attempt.leaseToken
pure def stepNoResend(before: CloseAttempt, after: CloseAttempt): bool =
  (before.attempt.id == after.attempt.id and before.attempt.state != NoAttempt) implies after.attempt.requests >= before.attempt.requests
pure def stepRecheckAdvances(before: CloseAttempt, after: CloseAttempt): bool = after.recheck.gate.seq >= before.recheck.gate.seq
pure def stepCandidateFixed(before: CloseAttempt, after: CloseAttempt): bool = after.candidate == before.candidate
pure def sometimesPendingAfterRequest(c: CloseAttempt): bool = c.attempt.state == Pending and c.attempt.requests == 1
pure def sometimesPendingAfterLeaseLost(c: CloseAttempt): bool =
  c.attempt.state == Pending and c.attempt.requests == 0 and c.recheck.lease.token != c.attempt.leaseToken
```

### A close that a later recheck or capacity refuses is labeled instead and never retried for this revision

Source `runReview`: [the closure decision](./closure.md) has already
labeled the candidate with its category label (`labelFinding`) before the
close is reserved, so a blocked close adds no label; it only has its
category-label comment updated (`upsertComment` with `labelComment`). When
the final check fails that comment says "source, policy, evidence or
eligibility changed before closure"; when capacity refuses (daily cap,
reopen breaker, another pending close of the item, or a changed fence) it
says "closure authority changed, the daily cap was reached, or a close is
already pending". Either finishes the review as labeled, so the block is
final for this revision. The comment is updated only while ordinary review
actions are still allowed, under the current lease.

```quint
type RefusalReason = CapReached | BreakerTripped | ItemPending | FenceChanged | LeaseLost
type CapacityRefusal = { repository: int, itemNode: str, revision: str, observedSeq: int, leaseToken: int,
  reason: RefusalReason }
pure def canBlockClose(c: CloseAttempt): bool =
  c.attempt.state == NoAttempt and c.blocked == NotBlocked and freshAfterDecision(c) and
  leaseHeld(c.recheck.lease) and not(gatesCurrent(c))
pure def blockClose(c: CloseAttempt): CloseAttempt = { ...c, blocked: GatesChanged }
pure def canBlockForCapacity(c: CloseAttempt, capacityRefusal: CapacityRefusal): bool =
  c.attempt.state == NoAttempt and c.blocked == NotBlocked and mayReserve(c) and
  capacityRefusal.repository == c.candidate.identity.repository and
  capacityRefusal.itemNode == c.candidate.identity.itemNode and
  capacityRefusal.revision == c.candidate.identity.revision and capacityRefusal.observedSeq == c.recheck.gate.seq and
  capacityRefusal.leaseToken == c.recheck.lease.token and capacityRefusal.reason != LeaseLost
pure def blockForCapacity(c: CloseAttempt, capacityRefusal: CapacityRefusal): CloseAttempt = { ...c, blocked: CapacityRefused }
pure def canCommentBlocked(c: CloseAttempt): bool =
  c.blocked != NotBlocked and not(c.blockedCommented) and not(disputed(c)) and leaseHeld(c.recheck.lease) and
  C::mayActOrdinaryFor(c.recheck.gate.source, c.candidate.identity) and
  C::effectiveMode(c.recheck.gate.source, c.candidate.triage.verdict.category) != C::ModeOff
pure def commentBlocked(c: CloseAttempt): CloseAttempt = { ...c, blockedCommented: true }
pure def alwaysBlockedNeverAttempts(c: CloseAttempt): bool = c.blocked != NotBlocked implies c.attempt.state == NoAttempt
pure def alwaysBlockedCommentOnlyAfterBlock(c: CloseAttempt): bool = c.blockedCommented implies c.blocked != NotBlocked
pure def stepBlockIsFinal(before: CloseAttempt, after: CloseAttempt): bool =
  before.blocked != NotBlocked implies after.blocked == before.blocked
pure def sometimesBlockedAndCommented(c: CloseAttempt): bool = c.blocked == GatesChanged and c.blockedCommented
pure def sometimesCapacityRefusedAndCommented(c: CloseAttempt): bool = c.blocked == CapacityRefused and c.blockedCommented
```

## Story: Confirm or release an attempt only on GitHub's evidence

### Only GitHub's own close event confirms and only a definitive refusal releases

A confirmed close needs GitHub's close event by the Slopbot App on the
reviewed revision with its `closed_at`. A definitive 401, 403, 404, 410, 422
or 429 response rejects the attempt and releases its slot; a later retry
reserves a new attempt with a fresh recheck and never rewrites the rejected
one. A timeout, a lost response, a human close or unavailable evidence keeps
the attempt pending: a pending attempt never expires with the review lease
and keeps occupying capacity until reconciled. Confirmation is recorded even
after a maintainer reopened the revision, because GitHub did close it; the
reversal below then undoes it. After confirmation the close comment is
retried until GitHub confirms it. The candidate stays what closure decided:
two confirming model verdicts, or the deterministic missing-evidence finding,
whose recheck must repeat the finding from the fresh body and guide
(`stillMayClose` in `review.ts`, development `bf73d46fa`).

```quint
type CloseActor = ActorUnknown | SlopbotApp | HumanActor
type CloseEvidence = { itemNode: str, revision: str, closedBy: CloseActor, closedAt: int }
type GithubRefusal = { attemptId: int, status: int }
pure def definitiveRefusal(status: int): bool =
  status == 401 or status == 403 or status == 404 or status == 410 or status == 422 or status == 429
pure def lawAmbiguousResponseNeverReleases(status: int): bool =
  (status == 408 or status == 500 or status == 502 or status == 503 or status == 504 or status == 0) implies
    not(definitiveRefusal(status))
pure val statusValues = Set(0, 401, 403, 404, 408, 410, 422, 429, 500, 502, 503, 504)
pure def canConfirmClose(c: CloseAttempt, closeEvent: CloseEvidence): bool =
  c.attempt.state == Pending and c.attempt.requests == 1 and closeEvent.itemNode == c.candidate.identity.itemNode and
  closeEvent.revision == c.candidate.identity.revision and closeEvent.closedBy == SlopbotApp and closeEvent.closedAt > 0
pure def confirmClose(c: CloseAttempt, closeEvent: CloseEvidence): CloseAttempt =
  { ...c, attempt: { ...c.attempt, state: Confirmed, closedAt: closeEvent.closedAt } }
pure def canRejectClose(c: CloseAttempt, githubRefusal: GithubRefusal): bool =
  c.attempt.state == Pending and c.attempt.requests == 1 and githubRefusal.attemptId == c.attempt.id and
  definitiveRefusal(githubRefusal.status)
pure def rejectClose(c: CloseAttempt, githubRefusal: GithubRefusal): CloseAttempt =
  { ...c, attempt: noAttempt, rejected: c.rejected.append(githubRefusal.attemptId) }
pure def canConfirmCloseComment(c: CloseAttempt): bool = c.attempt.state == Confirmed and not(c.attempt.commentConfirmed)
pure def confirmCloseComment(c: CloseAttempt): CloseAttempt = { ...c, attempt: { ...c.attempt, commentConfirmed: true } }
pure def closedBySlopbot(c: CloseAttempt): bool = c.attempt.state == Confirmed
pure def alwaysConfirmedHasCloseTime(c: CloseAttempt): bool =
  (c.attempt.state == Confirmed implies c.attempt.closedAt > 0 and c.attempt.requests == 1) and
  (c.attempt.state != Confirmed implies c.attempt.closedAt == 0 and not(c.attempt.commentConfirmed))
pure def alwaysRejectedIdsOrdered(c: CloseAttempt): bool =
  c.rejected.every(r => r > 0 and (c.attempt.state == NoAttempt or r < c.attempt.id))
pure def alwaysCandidateStaysEligible(c: CloseAttempt): bool =
  (C::confirms(c.candidate.triage, c.candidate.confirm) or C::evidenceCandidate(c.candidate.triage)) and
  c.candidate.identity.kind == C::PullRequest and
  F::permittedAction(c.candidate.triage.verdict.category) == F::CloseAllowed and c.candidate.decidedSeq > 0
pure def stepRejectedHistoryRetained(before: CloseAttempt, after: CloseAttempt): bool =
  after.rejected.length() >= before.rejected.length() and before.rejected.every(r => after.rejected.includes(r))
pure def stepConfirmedIsFinal(before: CloseAttempt, after: CloseAttempt): bool = before.attempt.state == Confirmed implies
  after.attempt.state == Confirmed and after.attempt.id == before.attempt.id and after.attempt.closedAt == before.attempt.closedAt
pure def stepPendingLeavesOnlyOnEvidence(before: CloseAttempt, via: str, after: CloseAttempt): bool =
  (before.attempt.state == Pending and after.attempt.state != Pending) implies (via == "confirmClose" or via == "rejectClose")
pure def sometimesConfirmedClose(c: CloseAttempt): bool = c.attempt.state == Confirmed and c.attempt.commentConfirmed
pure def sometimesRejectedThenReserved(c: CloseAttempt): bool = c.rejected.length() > 0 and c.attempt.state == Pending
```

### A confirmed scam closure notifies each moderator once and adds the moderator label

Source `notifyScamReviewForPenalty`: a confirmed close of a `scam` finding
(the only `moderator_review` category) records one moderator Inbox notice
per configured moderator under an idempotent key and adds the
`slopbot: moderator` label, but only when the close recorded an active
penalty with moderator review (`penalty?.moderator_review === 1`,
`review.ts` lines 1107, 1258 and 1994). A close whose revision a maintainer
reopened records no penalty, or has its penalty reversed as a late reopen
before the notice, so it notifies no one and adds no label. An upheld
appeal reverses the penalty too (`reversePenalty(db, node, "appeal_upheld",
covered)`, `review.ts` lines 3188 and 3218), and `activePenalty` reads only
a penalty that is not reversed (`penalties.ts` lines 124-138), so a notice
or label still owed after an upheld appeal is never sent. The notice is
retried from the committed close even after GitHub already shows the item
closed. Moderators are the PRD section 9 GitHub actors 18633264 and
202660855.

```quint
pure val slopModerators: Set[int] = Set(18633264, 202660855)
pure def moderatorPenaltyRecorded(c: CloseAttempt): bool =
  closedBySlopbot(c) and F::moderatorReview(c.candidate.triage.verdict.category) and not(c.maintainerReopened)
    and not(c.appealUpheld)
pure def canNotifyModerator(c: CloseAttempt, recipient: int): bool =
  moderatorPenaltyRecorded(c) and slopModerators.contains(recipient) and not(c.moderatorNotices.contains(recipient))
pure def notifyModerator(c: CloseAttempt, recipient: int): CloseAttempt =
  { ...c, moderatorNotices: c.moderatorNotices.union(Set(recipient)) }
pure def canAddModeratorLabel(c: CloseAttempt): bool = moderatorPenaltyRecorded(c) and not(c.moderatorLabel)
pure def addModeratorLabel(c: CloseAttempt): CloseAttempt = { ...c, moderatorLabel: true }
pure def alwaysNoticesOnlyForConfirmedScam(c: CloseAttempt): bool =
  (c.moderatorNotices.size() > 0 or c.moderatorLabel) implies closedBySlopbot(c) and c.candidate.triage.verdict.category == F::Scam
pure def alwaysNoticesToModerators(c: CloseAttempt): bool = c.moderatorNotices.subseteq(slopModerators)
pure def sometimesEveryModeratorNotified(c: CloseAttempt): bool = slopModerators.subseteq(c.moderatorNotices) and c.moderatorLabel
pure val fair_notifyModerator = "weak"
pure def leadsToEveryModeratorNotified(c: CloseAttempt, later: CloseAttempt): bool =
  moderatorPenaltyRecorded(c) implies (slopModerators.subseteq(later.moderatorNotices) or later.maintainerReopened
    or later.appealUpheld)
pure def sometimesReopenedScamCloseNotifiesNoOne(c: CloseAttempt): bool =
  closedBySlopbot(c) and c.maintainerReopened and c.moderatorNotices.size() == 0 and not(c.moderatorLabel)
```

## Story: A maintainer reopen or an upheld appeal undoes Slopbot's own close

### A reopen or appeal of the revision stops any further reservation or request

A current maintainer's reopen, the author's reopen (an appeal) and the
author's `/slopbot appeal` of this revision each stop any new reservation and
any request not yet sent. A reopen by anyone else records no decision.

```quint
pure def canObserveReopen(c: CloseAttempt, reopen: C::ReopenEvidence): bool =
  reopen.itemNode == c.candidate.identity.itemNode and reopen.revision == c.candidate.identity.revision and
  reopen.at > 0 and (reopen.role == C::ReopenByMaintainer or
    (reopen.role == C::ReopenByAuthor and reopen.actor == c.candidate.identity.author))
pure def observeReopen(c: CloseAttempt, reopen: C::ReopenEvidence): CloseAttempt =
  if (reopen.role == C::ReopenByMaintainer) { ...c, maintainerReopened: true } else { ...c, authorAppealed: true }
pure def canObserveAuthorAppeal(c: CloseAttempt, appellant: int): bool =
  appellant == c.candidate.identity.author and appellant > 0
pure def observeAuthorAppeal(c: CloseAttempt, appellant: int): CloseAttempt = { ...c, authorAppealed: true }
pure def canObserveAppealOutcome(c: CloseAttempt, appealOutcome: C::AppealOutcome): bool =
  appealOutcome.itemNode == c.candidate.identity.itemNode and appealOutcome.revision == c.candidate.identity.revision and
  appealOutcome.verdict == C::AppealUpheld and not(c.appealUpheld)
pure def observeAppealOutcome(c: CloseAttempt, appealOutcome: C::AppealOutcome): CloseAttempt = { ...c, appealUpheld: true }
pure def stepDisputeIsPermanent(before: CloseAttempt, after: CloseAttempt): bool =
  (before.maintainerReopened implies after.maintainerReopened) and (before.authorAppealed implies after.authorAppealed) and
  (before.appealUpheld implies after.appealUpheld)
pure def stepNoReservationAfterDispute(before: CloseAttempt, after: CloseAttempt): bool =
  (disputed(before) and before.attempt.state == NoAttempt) implies after.attempt.state == NoAttempt
pure def stepNoRequestAfterDispute(before: CloseAttempt, via: str, after: CloseAttempt): bool =
  via == "requestClose" implies not(disputed(before))
```

### Slopbot reopens its own close, read fresh, after a maintainer reopen or an upheld appeal

Source `finishAppeal` and `reconcileConfirmedReopen`: when this revision's
close is confirmed and a maintainer reopened the revision (including a close
that GitHub confirmed after the maintainer's reopen) or an appeal of it was
upheld, Slopbot reopens the item only while a fresh read of the exact item
and revision shows Slopbot's own close; a later human close or a newer head
stays. Each item read has a larger sequence number than the last.

```quint
type CurrentItemState = { seq: int, itemNode: str, revision: str, item: C::ItemCondition, closedBy: C::ClosedBy,
  installation: C::InstallationStatus }
pure val unreadItem: CurrentItemState = { seq: 0, itemNode: "", revision: "", item: C::ItemUnknown,
  closedBy: C::NotClosed, installation: C::InstallationUnknown }
pure def canObserveItem(c: CloseAttempt, itemState: CurrentItemState): bool =
  itemState.seq > c.itemNow.seq and itemState.itemNode == c.candidate.identity.itemNode
pure def observeItem(c: CloseAttempt, itemState: CurrentItemState): CloseAttempt = { ...c, itemNow: itemState }
pure def reversalDue(c: CloseAttempt): bool = closedBySlopbot(c) and (c.maintainerReopened or c.appealUpheld)
pure def ownCloseCurrent(c: CloseAttempt): bool =
  c.itemNow.itemNode == c.candidate.identity.itemNode and c.itemNow.revision == c.candidate.identity.revision and
  c.itemNow.item == C::ItemClosed and c.itemNow.closedBy == C::ClosedBySlopbot
pure def canReopenOwnClose(c: CloseAttempt): bool =
  reversalDue(c) and not(c.slopbotReopened) and ownCloseCurrent(c) and c.itemNow.installation == C::InstallationActive
pure def reopenOwnClose(c: CloseAttempt): CloseAttempt = { ...c, slopbotReopened: true }
pure def alwaysSlopbotReopensOnlyOwnClose(c: CloseAttempt): bool = c.slopbotReopened implies reversalDue(c)
pure def stepItemReadsAdvance(before: CloseAttempt, after: CloseAttempt): bool =
  after.itemNow.seq >= before.itemNow.seq and (before.slopbotReopened implies after.slopbotReopened)
pure def sometimesLateCloseReversed(c: CloseAttempt): bool = c.slopbotReopened and c.maintainerReopened and not(c.appealUpheld)
pure def sometimesAppealReopened(c: CloseAttempt): bool = c.slopbotReopened and c.appealUpheld
pure def sometimesHumanCloseKept(c: CloseAttempt): bool =
  reversalDue(c) and not(c.slopbotReopened) and c.itemNow.closedBy == C::ClosedByHuman
pure val fair_reopenOwnClose = "weak"
pure def leadsToOwnCloseReversed(c: CloseAttempt, later: CloseAttempt): bool =
  (reversalDue(c) and ownCloseCurrent(c) and c.itemNow.installation == C::InstallationActive) implies
    (later.slopbotReopened or not(ownCloseCurrent(later)) or later.itemNow.installation != C::InstallationActive)
```

### Simulation samples cover stale rechecks, lost leases, changed fences and refusals

```quint
pure val candidateTriage: C::AssessedVerdict = { verdict: { ...C::spamVerdict, category: F::Scam }, grounded: true, related: false }
pure val candidateConfirm: C::AssessedVerdict = { verdict: { ...C::spamVerdict, callId: "k", category: F::Scam },
  grounded: true, related: false }
pure val decidedCandidate: Candidate = { identity: C::reviewedItem, triage: candidateTriage, confirm: candidateConfirm,
  decidedSeq: 1 }
pure val currentFence: ProjectFence = { project: 1, projectRevision: 3, manifestDigest: "m3", enforcementPosition: 4 }
pure val heldLease: LeaseView = { token: 11, running: true, expiresAt: 100, observedAt: 10 }
pure val scamGate: C::GateObservation = { ...C::eligibleGate, activation: { ...C::activeSpam, category: F::Scam } }
pure val initial: CloseAttempt = { candidate: decidedCandidate,
  recheck: { gate: scamGate, fence: currentFence, lease: noLease }, attempt: noAttempt, rejected: List(),
  blocked: NotBlocked, blockedCommented: false, moderatorNotices: Set(), moderatorLabel: false,
  maintainerReopened: false, authorAppealed: false, appealUpheld: false, itemNow: unreadItem, slopbotReopened: false }
pure val freshRecheck: Recheck = { gate: { ...scamGate, seq: 2 }, fence: currentFence, lease: heldLease }
pure val recheckValues = Set(freshRecheck, { ...freshRecheck, gate: { ...scamGate, seq: 3 } },
  { ...freshRecheck, gate: { ...scamGate, seq: 3 }, lease: { ...heldLease, token: 12 } },
  { ...freshRecheck, gate: { ...scamGate, seq: 3, activation: C::inactive } },
  { ...freshRecheck, gate: { ...scamGate, seq: 4 }, fence: { ...currentFence, projectRevision: 4 } },
  { ...freshRecheck, gate: { ...scamGate, seq: 4 }, lease: { ...heldLease, observedAt: 100 } })
pure val grantValues = Set({ repository: 7, itemNode: "pr", revision: "head", attemptId: 1, fence: currentFence,
  leaseToken: 11, observedSeq: 2 }, { repository: 7, itemNode: "pr", revision: "head", attemptId: 2, fence: currentFence,
  leaseToken: 11, observedSeq: 3 })
pure val githubRefusalValues = Set({ attemptId: 1, status: 422 }, { attemptId: 1, status: 503 })
pure val capacityRefusalValues = Set({ repository: 7, itemNode: "pr", revision: "head", observedSeq: 2, leaseToken: 11,
  reason: CapReached }, { repository: 7, itemNode: "pr", revision: "head", observedSeq: 2, leaseToken: 11, reason: LeaseLost })
pure val closeEventValues = Set({ itemNode: "pr", revision: "head", closedBy: SlopbotApp, closedAt: 100 },
  { itemNode: "pr", revision: "head", closedBy: HumanActor, closedAt: 100 })
pure val recipientValues = Set(18633264, 202660855, 5)
pure val reopenValues = Set({ itemNode: "pr", revision: "head", actor: 9, role: C::ReopenByMaintainer, at: 50 },
  { itemNode: "pr", revision: "head", actor: 6, role: C::ReopenByOther, at: 50 })
pure val appellantValues = Set(5)
pure val appealOutcomeValues = Set({ itemNode: "pr", revision: "head", verdict: C::AppealUpheld })
pure val itemStateValues = Set({ seq: 1, itemNode: "pr", revision: "head", item: C::ItemClosed, closedBy: C::ClosedBySlopbot,
  installation: C::InstallationActive }, { seq: 2, itemNode: "pr", revision: "head", item: C::ItemClosed,
  closedBy: C::ClosedByHuman, installation: C::InstallationActive })
pure val weight_observeRecheck = 4
pure val weight_reserveClose = 10
pure val weight_requestClose = 10
pure val weight_confirmClose = 8
pure val weight_rejectClose = 4
pure val weight_confirmCloseComment = 6
pure val weight_notifyModerator = 6
pure val weight_commentBlocked = 6
pure val weight_reopenOwnClose = 8
```

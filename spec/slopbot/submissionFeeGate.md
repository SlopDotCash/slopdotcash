# Submission fee gate

PRD section 5, "Submission fee", and the operator decisions of 18 November
2026 (record-only from 19 November, live since 21 November): a project
owner may ask an outside contributor for a refundable deposit before
Slopbot reviews a new pull request. Source `workers/slopbot/submission-fee.ts`
(`gateSubmissionFee`, `releaseExemptFee`, `refreshSubmissionFee`,
`feeOutcome`, `dispatchFeeChecks`, `feeUnpaid`), `review-cap.ts`
(`monthlyReviewOpen`), `migrations/0142_slopbot_fee_gates.sql`,
`submission-fee.test.ts`, the README section "Submission fee" and
development's own model `formal/models/slopbot/bot_submission_fee.qnt`
(development `8008b4617`, #3058; `9d3a659cd`, #3061; `bd10de431`, #3064;
`8e8646346`, #3092; `38e65746f`, #3093; `c5ec2b213`, #3174; `38b78cd3b`,
#3176; `41c784d99`, #3186).

One instance is the gate of one pull request, keyed by the permanent
repository ID and the pull request number: Slopbot's row in
`slopbot_fee_gates` and the shared row in `submission_fee_items`. Slopbot
writes the gate, asks (creating the unpaid item at the setting's amount),
takes an unpaid ask back (deleting the unpaid item) and sets a due outcome
on a paid row. The submission-fee Worker of `apps/fees` marks an item paid,
withdraws a payment a reorganised block removed, and records the refund or
the kept fee; those are observations here, never Slopbot's own writes.
Slopbot moves no money. The fee amounts, the published deposit contracts,
the rates and the refund itself are the submission-fee owner's
(`spec/backend/submissionFeeTerms.md`, `spec/backend/submissionFeeSettings.md`
and the deposits of `spec/fees/`); this machine reads them as facts.

Every fact is read by a named verified service: `FeeFacts.mode` is the
Worker configuration `SUBMISSION_FEE_MODE`; `contractPublished` is a
published deposit contract in the terms (`feeWays` is not empty);
`feeSetting` is the project's stored setting in the registry, read as the
[submission fee setting](../backend/submissionFeeSettings.md) reads it
(`settingOn` and `settingAmount`: on only with a valid amount);
`settingSince` is the time of the first revision after the latest one that
had it off (`feeSettingSince`, 0 while
off); `openedAt` is GitHub's `created_at` of the pull request; `exemption`
is the author's write access or organisation membership as the review reads
it; `mayAsk` is the monthly free-review cap's non-reserving read
(`monthlyReviewOpen`, the [monthly cap](./reviewCap.md) admitting the item
without reserving it). `PullFacts` is the fee check's read of the pull
request, the installation and the project's contributor scope. A shell
obligation remains: no fact is taken from request text.

## Story: Ask an outside contributor's deposit before the review, and never close for it

> As a project owner who turned the submission fee on, I want Slopbot to ask
> a new outside contributor for the refundable deposit once, hold its free
> review until the deposit is paid, and let the refund or the kept fee
> follow what happens to the pull request, without ever closing it for the
> fee.

### Only a live fee with a published contract asks, and only a new outside pull request of a project with the setting on

The gate is called by the review of a pull request in contributor scope,
after binding and the intake-cap skip ([review](./review.md)); closed,
merged and draft items, bots and exempt authors are skipped before it. With
the mode off or no published contract nothing happens and the review runs.
The fee applies when the effective setting is on, the author is known not
exempt, the setting has a start time and the pull request was opened after
it. In live mode a paid item lets the review run. Where the fee does not
apply, an ask that stands (asked, or an asking lease that ran out) is taken
back when the setting is off or the author is exempt, and the review runs;
an unknown exemption changes nothing, and an ask that is not taken back
keeps the review waiting (`fee-needed`). Where it applies, an asked pull
request, or a paid gate whose payment was withdrawn, waits; with the month's
cap full nothing is asked and the review runs (no fee for a review the cap
would refuse); otherwise the gate claims the ask and the review waits.

```quint
import submissionFeeTerms as T from "../backend/submissionFeeTerms"
import submissionFeeSettings as S from "../backend/submissionFeeSettings"
import mergeActivity as M from "../backend/mergeActivity"
type FeeMode = FeeOff | FeeDryRun | FeeLive
type FeeExemption = Exempt | NotExempt | ExemptionUnknown
type GateState = NoGate | Recorded | Asking | Asked | Paid | Released
type Settlement = NoSettlement | RefundDue | KeptDue | Refunded | Kept
type FeeStep = FeeRuns | FeeRecords | FeeReleases | FeeClaims | FeeWaits
type FeeFacts = { mode: FeeMode, contractPublished: bool, feeSetting: S::StoredFeeSetting, settingSince: int, openedAt: int,
  exemption: FeeExemption, mayAsk: bool }
type FeeItem = { present: bool, paid: bool, paidAt: int, amountMinor: int, settlement: Settlement }
type WantedLink = LinkUnread | InvitedWork | NotInvited
type PullFacts = { readable: bool, open: bool, merged: bool, draft: bool, closedAt: int, appealOpen: bool, appealUpheldAt: int,
  contributorScope: bool, installationActive: bool, invited: WantedLink, keepMarked: bool, keepMarkedAt: int }
type FeeGate = { now: int, gate: GateState, commentId: int, nextCheckAt: int, updatedAt: int, feeItem: FeeItem,
  labelNeeded: bool, labelPaid: bool, reviewsQueued: int }
pure val askLeaseSeconds = 600
pure val recheckSeconds = 86400
pure val daySeconds = 86400
pure val noItem: FeeItem = { present: false, paid: false, paidAt: 0, amountMinor: 0, settlement: NoSettlement }
pure val initial: FeeGate = { now: 1793491200, gate: NoGate, commentId: 0, nextCheckAt: 0, updatedAt: 0, feeItem: noItem,
  labelNeeded: false, labelPaid: false, reviewsQueued: 0 }
pure def settingOn(facts: FeeFacts): bool = S::feeSettingOn(facts.feeSetting)
pure def settingAmount(facts: FeeFacts): int = S::feeSettingAmount(facts.feeSetting)
pure def feeLive(facts: FeeFacts): bool = facts.mode == FeeLive and facts.contractPublished
pure def checkable(g: FeeGate, facts: FeeFacts, pull: PullFacts): bool =
  feeLive(facts) and g.gate != NoGate and g.feeItem.present and pull.installationActive and pull.readable
pure def applies(facts: FeeFacts): bool =
  settingOn(facts) and facts.exemption == NotExempt and facts.settingSince > 0 and facts.openedAt > facts.settingSince
pure def askInFlight(g: FeeGate): bool = g.gate == Asking and g.updatedAt > g.now - askLeaseSeconds
pure def askStands(g: FeeGate): bool = g.gate == Asked or (g.gate == Asking and not(askInFlight(g)))
pure def claimable(g: FeeGate): bool =
  g.gate == NoGate or g.gate == Recorded or g.gate == Released or (g.gate == Asking and not(askInFlight(g)))
pure def unpaidAsk(g: FeeGate): bool = (g.gate == Asking or g.gate == Asked) and g.feeItem.present and not(g.feeItem.paid)
pure def feeStep(g: FeeGate, facts: FeeFacts): FeeStep =
  if (facts.mode == FeeOff or not(facts.contractPublished)) FeeRuns
  else if (facts.mode == FeeDryRun)
    (if (applies(facts) and not(g.feeItem.present) and g.gate == NoGate and facts.mayAsk) FeeRecords else FeeRuns)
  else if (g.feeItem.paid) FeeRuns
  else if (not(applies(facts)))
    (if (askStands(g) and (not(settingOn(facts)) or facts.exemption == Exempt)) FeeReleases
     else if (g.gate == Asked or g.gate == Asking) FeeWaits
     else FeeRuns)
  else if (g.gate == Asked or g.gate == Paid) FeeWaits
  else if (not(facts.mayAsk)) FeeRuns
  else if (claimable(g)) FeeClaims
  else FeeWaits
pure def reviewWaits(g: FeeGate, facts: FeeFacts): bool = feeStep(g, facts) == FeeClaims or feeStep(g, facts) == FeeWaits
pure def canElapse(g: FeeGate, seconds: int): bool = seconds > 0
pure def elapse(g: FeeGate, seconds: int): FeeGate = { ...g, now: g.now + seconds }
pure def lawOffOrUnpublishedNeverWaits(g: FeeGate, facts: FeeFacts): bool =
  (facts.mode == FeeOff or not(facts.contractPublished)) implies not(reviewWaits(g, facts))
pure def lawPaidFeeNeverHoldsTheReview(g: FeeGate, facts: FeeFacts): bool =
  (facts.mode == FeeLive and g.feeItem.paid) implies not(reviewWaits(g, facts))
pure def lawFullMonthAsksNothing(g: FeeGate, facts: FeeFacts): bool =
  not(facts.mayAsk) implies (feeStep(g, facts) != FeeClaims and feeStep(g, facts) != FeeRecords)
pure def lawOnlyAnOutsideNewPullIsAsked(g: FeeGate, facts: FeeFacts): bool =
  feeStep(g, facts) == FeeClaims implies
    (settingOn(facts) and facts.exemption == NotExempt and facts.openedAt > facts.settingSince and facts.settingSince > 0)
```

### One job asks under a lease, and a failed write hands the lease back

The ask is claimed in one conditional write: from no gate, a recorded or a
released gate, or an asking gate whose ten-minute lease ran out; any other
job meanwhile waits without writing. The claim upserts the unpaid item at
the setting's amount (the amount is fixed at the first real ask), then
writes the one fee comment and the label `slopbot:fee-needed`, and records
the gate asked with the comment's ID. The comment carries the marker
`<!-- slopbot:fee -->`; it is the stored comment, or found again only by the
App's own account and the marker, never by text alone, so a pasted marker
is not Slopbot's comment, and a deleted one is looked for once more before a
new one is posted. When the comment or label write fails, the job sets the
gate's time back by the lease to the job's own claim time, so the queue's
retry a minute later takes the ask, and finds the comment again by its
marker.

```quint
pure def canClaimAsk(g: FeeGate, facts: FeeFacts): bool = feeStep(g, facts) == FeeClaims and settingAmount(facts) > 0
pure def claimAsk(g: FeeGate, facts: FeeFacts): FeeGate =
  { ...g, gate: Asking, updatedAt: g.now, nextCheckAt: 0,
    feeItem: { present: true, paid: false, paidAt: 0, amountMinor: settingAmount(facts), settlement: NoSettlement } }
pure def canConfirmAsk(g: FeeGate, commentId: int): bool = g.gate == Asking and commentId > 0
pure def confirmAsk(g: FeeGate, commentId: int): FeeGate =
  { ...g, gate: Asked, commentId: commentId, labelNeeded: true, updatedAt: g.now }
pure def canFailAsk(g: FeeGate): bool = askInFlight(g)
pure def failAsk(g: FeeGate): FeeGate = { ...g, updatedAt: g.updatedAt - askLeaseSeconds }
pure def alwaysAskHasItem(g: FeeGate): bool =
  (g.gate == Asking or g.gate == Asked or g.gate == Paid) iff g.feeItem.present
pure def alwaysAskedWasCommented(g: FeeGate): bool =
  (g.gate == Asked or g.gate == Paid or g.gate == Released) implies g.commentId > 0
pure def alwaysCountsNotNegative(g: FeeGate): bool =
  g.now > 0 and g.nextCheckAt >= 0 and g.reviewsQueued >= 0 and g.commentId >= 0
pure def sometimesAsked(g: FeeGate): bool = g.gate == Asked and g.labelNeeded
pure def sometimesLeaseHandedBack(g: FeeGate): bool = g.gate == Asking and not(askInFlight(g))
```

### Record-only mode notes the ask and writes nothing else

In record-only mode (`dry_run`) the gate records, once, a pull request that
live mode would ask (applies, no item, no gate and the month's cap open)
and the review runs. Nothing is written to GitHub and no item row is
created, so no deposit can pay it and the pay page shows nothing; the first
real ask writes the row.

```quint
pure def canRecord(g: FeeGate, facts: FeeFacts): bool = feeStep(g, facts) == FeeRecords
pure def record(g: FeeGate, facts: FeeFacts): FeeGate = { ...g, gate: Recorded, updatedAt: g.now }
pure def alwaysRecordedWroteNothing(g: FeeGate): bool =
  (g.gate == NoGate or g.gate == Recorded) implies (not(g.feeItem.present) and g.commentId == 0 and not(g.labelNeeded) and not(g.labelPaid))
pure def stepRecordWritesNoItem(before: FeeGate, via: str, after: FeeGate): bool =
  via == "record" implies (after.feeItem == before.feeItem and after.commentId == before.commentId and
    after.labelNeeded == before.labelNeeded and after.labelPaid == before.labelPaid)
pure def sometimesRecorded(g: FeeGate): bool = g.gate == Recorded
```

### An ask that stops applying is taken back and its unpaid item removed

An ask that stands is taken back when the owner turned the setting off or
the author is now exempt (the review's exempt-author release, the gate, or
the fee check reading the stored setting whatever the project's status):
the label comes off, the comment says why, the gate reads released, and the
unpaid item row is deleted last, so a deposit sent afterwards names an
unknown item and is refunded by the submission-fee Worker. A later first
ask writes the row again. An ask another job is still writing is left to
finish first. The review that took an ask back runs on; the fee check that
takes one back (live, a published contract, an active installation, a
readable pull request, an unpaid item, the stored setting off) queues the
held review when the pull request is open and not a draft
(`refreshSubmissionFee`, "submission fee released: setting off").

```quint
pure def canRelease(g: FeeGate, facts: FeeFacts, commentId: int): bool =
  feeStep(g, facts) == FeeReleases and commentId > 0
pure def release(g: FeeGate, facts: FeeFacts, commentId: int): FeeGate =
  { ...g, gate: Released, commentId: commentId, labelNeeded: false, nextCheckAt: 0, updatedAt: g.now, feeItem: noItem }
pure def checkReleases(g: FeeGate, facts: FeeFacts): bool = askStands(g) and not(settingOn(facts))
pure def canReleaseChecked(g: FeeGate, facts: FeeFacts, pull: PullFacts, commentId: int): bool =
  checkable(g, facts, pull) and not(g.feeItem.paid) and checkReleases(g, facts) and commentId > 0
pure def releaseChecked(g: FeeGate, facts: FeeFacts, pull: PullFacts, commentId: int): FeeGate =
  val released = release(g, facts, commentId)
  { ...released, reviewsQueued: g.reviewsQueued + (if (pull.open and not(pull.merged) and not(pull.draft)) 1 else 0) }
pure def stepReleaseKeepsAPaidItem(before: FeeGate, via: str, after: FeeGate): bool =
  (via == "release" or via == "releaseChecked") implies not(before.feeItem.paid)
pure def sometimesReleasedReviewQueued(g: FeeGate): bool = g.gate == Released and g.reviewsQueued > 0
pure def sometimesReleased(g: FeeGate): bool = g.gate == Released and g.commentId > 0
```

### A paid fee runs the held review, and Slopbot sets only a due outcome on a paid row

The fee check (live, a published contract, a gate and an item, an active
installation, a readable pull request) of a paid item that no other job is
still asking for marks the gate paid: the first time it swaps
`slopbot:fee-needed` for `slopbot:fee-paid` (only while the project is open
to contributor work; the comment is written either way) and queues the held
review when the pull request is open and not a draft. On a paid row with no
outcome it then decides: merged, refund due; closed unmerged with a close
time, nothing while an appeal of Slopbot's own close is undecided (wait a
day); otherwise, with a close time later than fourteen days after the
payment, refund due as undecided, whenever the check runs and whatever the
keep label, the wanted link or an upheld appeal say, because no maintainer
merged or closed it within the fourteen days (PRD section 5, "Submission
fee"), and a late check must decide what a check on time would have; closed
at or before that time, nothing before seven days after the latest of the
close, the payment and any upheld close-appeal time (wait until then), and
after them:
invited work is refund due unless the pull request carries the terms' keep
label `slop-keep-fee` added at or before that seven-day deadline (an
unreadable addition time waits a day, and a keep label added after the
deadline yields refund due); any other pull request is kept due; and when
GitHub cannot say whether it is invited work, nothing is decided and it
looks again in a day; closed without a close time, or no payment time,
look again in a day; open, refund due fourteen days after the payment,
else look again at the earlier of that time and a day later, so a merge or
close whose webhook was lost is still seen. When an appeal of Slopbot's
close is opened or upheld after `kept_due` was written and before any
resolver send is recorded, Slopbot clears `kept_due` back to undecided and
schedules an immediate recheck (#3193, #3368). The outcome is written only on
a paid row whose outcome is still empty. A paid item checked while an ask is
in flight looks again after the lease. Only a paid fee, or an ask the fee
check took back, queues the held review. Refunded and kept are the
submission-fee Worker's records. The days are the published terms'
`SUBMISSION_FEE_REFUND_UNDECIDED_DAYS` and
`SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS`.

A pull request is invited work (operator decision, 22 November 2026;
development 7f71c6ce9 and main a73480a8c, `feeOutcome`, `wantedAtOpen`)
when an issue it closes, in its own repository, carried the wanted label
`slop-wanted` at the moment the pull request was opened: of that issue's
added and removed events of the label with a time at or before the
opening, the latest says. A label added later does not count, and the
project's wanted-issues setting is not consulted. The link is read (up to
ten closing issues, a hundred label events each) only for a closed,
unmerged pull request whose paid row has no outcome; the shell passes
`NotInvited` for any other. When a checked pull request is invited work,
Slopbot creates the keep label on the repository if it is missing, best
effort: that write never changes an outcome.

```quint
type FeeDecision = { settlement: Settlement, nextCheckAt: int }
pure def keptDeadline(paidAt: int, pull: PullFacts): int =
  val closeOrPaid = if (pull.closedAt > paidAt) pull.closedAt else paidAt
  val base = if (pull.appealUpheldAt > closeOrPaid) pull.appealUpheldAt else closeOrPaid
  base + T::keptAfterClosedDays * daySeconds
pure def closedUndecided(paidAt: int, pull: PullFacts): bool =
  not(pull.open) and not(pull.merged) and paidAt > 0 and pull.closedAt > paidAt + T::refundUndecidedDays * daySeconds
pure def settlementFor(paidAt: int, pull: PullFacts, now: int): FeeDecision =
  val keptAt = keptDeadline(paidAt, pull)
  val refundAt = paidAt + T::refundUndecidedDays * daySeconds
  if (pull.merged) { settlement: RefundDue, nextCheckAt: 0 }
  else if (not(pull.open))
    (if (pull.closedAt <= 0 or paidAt <= 0 or pull.appealOpen) { settlement: NoSettlement, nextCheckAt: now + recheckSeconds }
     else if (closedUndecided(paidAt, pull)) { settlement: RefundDue, nextCheckAt: 0 }
     else if (now < keptAt) { settlement: NoSettlement, nextCheckAt: keptAt }
     else if (pull.invited == LinkUnread) { settlement: NoSettlement, nextCheckAt: now + recheckSeconds }
     else if (pull.invited == InvitedWork and not(pull.keepMarked)) { settlement: RefundDue, nextCheckAt: 0 }
     else if (pull.invited == InvitedWork and pull.keepMarkedAt <= 0) { settlement: NoSettlement, nextCheckAt: now + recheckSeconds }
     else if (pull.invited == InvitedWork and pull.keepMarkedAt > keptAt) { settlement: RefundDue, nextCheckAt: 0 }
     else { settlement: KeptDue, nextCheckAt: 0 })
  else if (paidAt <= 0) { settlement: NoSettlement, nextCheckAt: now + recheckSeconds }
  else if (now >= refundAt) { settlement: RefundDue, nextCheckAt: 0 }
  else { settlement: NoSettlement, nextCheckAt: if (refundAt < now + recheckSeconds) refundAt else now + recheckSeconds }
pure def canRefreshPaid(g: FeeGate, facts: FeeFacts, pull: PullFacts, commentId: int): bool =
  checkable(g, facts, pull) and g.feeItem.paid and not(askInFlight(g)) and commentId > 0
pure def refreshPaid(g: FeeGate, facts: FeeFacts, pull: PullFacts, commentId: int): FeeGate =
  val first = g.gate != Paid
  val swap = first and pull.contributorScope
  val decided = if (g.feeItem.settlement == NoSettlement) settlementFor(g.feeItem.paidAt, pull, g.now)
    else { settlement: g.feeItem.settlement, nextCheckAt: 0 }
  { ...g, gate: Paid, commentId: commentId, updatedAt: g.now, nextCheckAt: decided.nextCheckAt,
    labelNeeded: if (swap) false else g.labelNeeded, labelPaid: if (swap) true else g.labelPaid,
    reviewsQueued: g.reviewsQueued + (if (first and pull.open and not(pull.draft)) 1 else 0),
    feeItem: { ...g.feeItem, settlement: decided.settlement } }
pure def canReopenKept(g: FeeGate): bool = g.gate == Paid and g.feeItem.paid and g.feeItem.settlement == KeptDue
pure def reopenKept(g: FeeGate): FeeGate = { ...g, nextCheckAt: g.now, feeItem: { ...g.feeItem, settlement: NoSettlement } }
pure def canDeferCheck(g: FeeGate, facts: FeeFacts, pull: PullFacts): bool =
  checkable(g, facts, pull) and g.feeItem.paid and askInFlight(g)
pure def deferCheck(g: FeeGate, facts: FeeFacts, pull: PullFacts): FeeGate = { ...g, nextCheckAt: g.now + askLeaseSeconds }
pure def canObservePaid(g: FeeGate, paidAt: int): bool = g.feeItem.present and not(g.feeItem.paid) and paidAt > 0
pure def observePaid(g: FeeGate, paidAt: int): FeeGate = { ...g, feeItem: { ...g.feeItem, paid: true, paidAt: paidAt } }
pure def canObserveSettled(g: FeeGate, settledAs: Settlement): bool =
  g.feeItem.paid and ((g.feeItem.settlement == RefundDue and settledAs == Refunded) or
    (g.feeItem.settlement == KeptDue and settledAs == Kept))
pure def observeSettled(g: FeeGate, settledAs: Settlement): FeeGate = { ...g, feeItem: { ...g.feeItem, settlement: settledAs } }
pure def alwaysSettlementOnPaidGate(g: FeeGate): bool =
  g.feeItem.settlement != NoSettlement implies (g.feeItem.paid and g.gate == Paid)
pure def stepSlopbotNeverPays(before: FeeGate, via: str, after: FeeGate): bool =
  after.feeItem.paid != before.feeItem.paid implies (via == "observePaid" or via == "observeWithdrawn")
pure def stepSlopbotSetsOnlyDueOutcomes(before: FeeGate, via: str, after: FeeGate): bool =
  after.feeItem.settlement != before.feeItem.settlement implies
    (via == "observeSettled" or
      (via == "reopenKept" and before.feeItem.paid and before.feeItem.settlement == KeptDue and after.feeItem.settlement == NoSettlement) or
      (via == "refreshPaid" and before.feeItem.paid and before.feeItem.settlement == NoSettlement and
        (after.feeItem.settlement == RefundDue or after.feeItem.settlement == KeptDue)))
pure def stepOnlyAPaidFeeQueuesTheReview(before: FeeGate, after: FeeGate): bool =
  after.reviewsQueued > before.reviewsQueued implies
    ((after.feeItem.paid and after.gate == Paid) or (after.gate == Released and not(after.feeItem.present)))
pure def lawMergedIsRefundDue(paidAt: int, pull: PullFacts, now: int): bool =
  pull.merged implies settlementFor(paidAt, pull, now).settlement == RefundDue
pure def lawKeptOnlyAfterTheWait(paidAt: int, pull: PullFacts, now: int): bool =
  settlementFor(paidAt, pull, now).settlement == KeptDue implies
    (not(pull.merged) and not(pull.open) and not(pull.appealOpen) and pull.closedAt > 0 and paidAt > 0 and
      pull.closedAt <= paidAt + T::refundUndecidedDays * daySeconds and now >= keptDeadline(paidAt, pull))
pure def lawClosedAfterTheRefundAgeIsRefundDue(paidAt: int, pull: PullFacts, now: int): bool =
  (closedUndecided(paidAt, pull) and not(pull.appealOpen)) implies settlementFor(paidAt, pull, now).settlement == RefundDue
pure def lawOpenAppealHoldsClosedFee(paidAt: int, pull: PullFacts, now: int): bool =
  (not(pull.open) and not(pull.merged) and pull.appealOpen) implies
    settlementFor(paidAt, pull, now).settlement == NoSettlement
pure def lawOpenRefundOnlyAfterTheWait(paidAt: int, pull: PullFacts, now: int): bool =
  (pull.open and not(pull.merged) and settlementFor(paidAt, pull, now).settlement == RefundDue) implies
    (paidAt > 0 and now >= paidAt + T::refundUndecidedDays * daySeconds)
type LabelEvent = { label: str, added: bool, at: int }
type ClosingIssue = { ownRepository: bool, events: List[LabelEvent] }
type LabelScan = { latest: int, labelled: bool }
pure def labelOnAt(events: List[LabelEvent], opened: int): bool =
  events.foldl({ latest: -1, labelled: false }, (acc, ev) =>
    if (ev.label == M::wantedLabelName and ev.at >= 0 and ev.at <= opened and ev.at >= acc.latest)
      { latest: ev.at, labelled: ev.added } else acc).labelled
pure def keepMarkAt(events: List[LabelEvent]): int =
  val scan = events.foldl({ latest: -1, labelled: false }, (acc, ev) =>
    if (ev.label == T::keepFeeLabel and ev.at > 0 and ev.at >= acc.latest)
      { latest: ev.at, labelled: ev.added } else acc)
  if (scan.labelled) scan.latest else 0
pure def invitedOf(readable: bool, issues: List[ClosingIssue], opened: int): WantedLink =
  if (not(readable)) LinkUnread
  else if (issues.some(closing => closing.ownRepository and labelOnAt(closing.events, opened))) InvitedWork
  else NotInvited
pure def keepMarkedOf(labels: List[str]): bool = labels.includes(T::keepFeeLabel)
pure def lawInvitedWorkIsKeptOnlyOnTheMark(paidAt: int, pull: PullFacts, now: int): bool =
  (settlementFor(paidAt, pull, now).settlement == KeptDue and pull.invited == InvitedWork) implies
    (pull.keepMarked and pull.keepMarkedAt > 0 and pull.keepMarkedAt <= keptDeadline(paidAt, pull))
pure def lawClosedRefundOnlyForUnmarkedInvitedWork(paidAt: int, pull: PullFacts, now: int): bool =
  (not(pull.open) and not(pull.merged) and not(closedUndecided(paidAt, pull)) and
    settlementFor(paidAt, pull, now).settlement == RefundDue) implies
    (pull.invited == InvitedWork and (not(pull.keepMarked) or pull.keepMarkedAt > keptDeadline(paidAt, pull)) and
      not(pull.appealOpen) and pull.closedAt > 0 and paidAt > 0 and now >= keptDeadline(paidAt, pull))
pure def lawUnreadLinkDecidesNoClosedFee(paidAt: int, pull: PullFacts, now: int): bool =
  (not(pull.open) and not(pull.merged) and pull.invited == LinkUnread and not(closedUndecided(paidAt, pull))) implies
    settlementFor(paidAt, pull, now).settlement == NoSettlement
pure def lawLabelAfterOpeningDoesNotInvite(e: LabelEvent, opened: int): bool =
  e.at > opened implies not(labelOnAt(List(e), opened))
pure def lawOtherLabelDoesNotInvite(e: LabelEvent, opened: int): bool =
  e.label != M::wantedLabelName implies not(labelOnAt(List(e), opened))
pure def lawLatestLabelEventDecides(e: LabelEvent, opened: int): bool =
  (e.label == M::wantedLabelName and e.at >= 0 and e.at <= opened) implies
    (labelOnAt(List(e), opened) == e.added and not(labelOnAt(List({ ...e, added: true }, { ...e, added: false }), opened)))
pure def lawOtherRepositoryDoesNotInvite(issue: ClosingIssue, opened: int): bool =
  not(issue.ownRepository) implies invitedOf(true, List(issue), opened) == NotInvited
pure def sometimesPaidReviewQueued(g: FeeGate): bool = g.gate == Paid and g.reviewsQueued > 0 and g.labelPaid
pure def sometimesRefundDue(g: FeeGate): bool = g.feeItem.settlement == RefundDue
pure def sometimesKeptDue(g: FeeGate): bool = g.feeItem.settlement == KeptDue
pure def sometimesRefunded(g: FeeGate): bool = g.feeItem.settlement == Refunded
```

### A withdrawn payment asks again

When the submission-fee Worker withdraws a payment that a chain
reorganisation removed, the review waits again, and the fee check of a paid
gate whose item is unpaid asks again: while the project is open to
contributor work the paid label comes off and the needed label goes back on
an open pull request, the comment asks again, and the gate reads asked
("payment withdrawn"). An unpaid gate that is neither released nor paid only
clears its timer.

```quint
pure def canObserveWithdrawn(g: FeeGate): bool = g.feeItem.paid and g.feeItem.settlement == NoSettlement
pure def observeWithdrawn(g: FeeGate): FeeGate = { ...g, feeItem: { ...g.feeItem, paid: false, paidAt: 0 } }
pure def canAskAgain(g: FeeGate, facts: FeeFacts, pull: PullFacts, commentId: int): bool =
  checkable(g, facts, pull) and g.gate == Paid and not(g.feeItem.paid) and commentId > 0
pure def askAgain(g: FeeGate, facts: FeeFacts, pull: PullFacts, commentId: int): FeeGate =
  { ...g, gate: Asked, commentId: commentId, nextCheckAt: 0, updatedAt: g.now,
    labelPaid: if (pull.contributorScope) false else g.labelPaid,
    labelNeeded: if (pull.contributorScope) pull.open else g.labelNeeded }
pure def canClearCheck(g: FeeGate, facts: FeeFacts, pull: PullFacts): bool =
  checkable(g, facts, pull) and not(g.feeItem.paid) and g.gate != Paid and not(checkReleases(g, facts))
pure def clearCheck(g: FeeGate, facts: FeeFacts, pull: PullFacts): FeeGate = { ...g, nextCheckAt: 0, updatedAt: g.now }
pure def sometimesAskedAgain(g: FeeGate): bool = g.gate == Asked and g.reviewsQueued > 0 and not(g.feeItem.paid)
```

### Due checks are claimed before they are sent, 20 every five minutes

The five-minute schedule, in live mode with a published contract, queues
the checks no webhook announces, at most 20 a run, timed ones first: a gate
whose timer is due, a paid item whose gate is not yet marked paid, a paid
gate whose payment was withdrawn (unless a fresh claim holds it), and an
asked, unpaid gate whose project no longer has the setting on. Each gate is
claimed, its timer set ten minutes ahead, before its job is sent, so an
overlapping run does not queue it twice; the job sets the next time itself.
A job that finds the installation removed or suspended, or cannot read the
pull request, decides nothing and sets that time a day ahead
(`recheckSeconds`), so gates that cannot be checked do not take every run
from the checks that can; a paid gate whose payment was withdrawn keeps the
claim's time, because its clause above passes over any later one.
A webhook for a paid pull request with no outcome queues the same check.
An unpaid fee never closes a pull request, and a failure of a fee step is
not a review attempt.

```quint
pure val feeDispatchBatch = 20
pure val feeDispatchSeconds = 300
pure def dueForCheck(g: FeeGate, facts: FeeFacts): bool =
  g.gate != NoGate and g.feeItem.present and
  ((g.nextCheckAt > 0 and g.nextCheckAt <= g.now) or
    (g.nextCheckAt == 0 and g.gate != Paid and g.feeItem.paid) or
    (g.gate == Paid and not(g.feeItem.paid) and g.feeItem.settlement == NoSettlement and
      (g.nextCheckAt == 0 or g.nextCheckAt <= g.now or g.nextCheckAt > g.now + askLeaseSeconds)) or
    (g.nextCheckAt == 0 and g.gate == Asked and not(g.feeItem.paid) and not(settingOn(facts))))
pure def canDispatch(g: FeeGate, facts: FeeFacts): bool = feeLive(facts) and dueForCheck(g, facts)
pure def dispatch(g: FeeGate, facts: FeeFacts): FeeGate = { ...g, nextCheckAt: g.now + askLeaseSeconds }
pure def stepDispatchClaimsAhead(before: FeeGate, via: str, after: FeeGate): bool =
  via == "dispatch" implies after.nextCheckAt == before.now + askLeaseSeconds
pure def sometimesDispatched(g: FeeGate): bool = g.nextCheckAt > g.now and g.gate == Paid
```

### Simulation samples cover every mode, exemption, setting and pull request state

These sets bound simulation only.

```quint
pure val liveFacts: FeeFacts = { mode: FeeLive, contractPublished: true, feeSetting: S::enabledDefault, settingSince: 1793400000,
  openedAt: 1793491100, exemption: NotExempt, mayAsk: true }
pure val factsValues = Set(liveFacts, { ...liveFacts, mode: FeeDryRun }, { ...liveFacts, mode: FeeOff },
  { ...liveFacts, contractPublished: false }, { ...liveFacts, feeSetting: S::feeSettingAbsent, settingSince: 0 },
  { ...liveFacts, exemption: Exempt }, { ...liveFacts, exemption: ExemptionUnknown }, { ...liveFacts, mayAsk: false },
  { ...liveFacts, openedAt: 1793300000 })
pure val openPull: PullFacts = { readable: true, open: true, merged: false, draft: false, closedAt: 0, appealOpen: false,
  appealUpheldAt: 0, contributorScope: true, installationActive: true, invited: NotInvited, keepMarked: false, keepMarkedAt: 0 }
pure val pullValues = Set(openPull, { ...openPull, open: false, merged: true, closedAt: 1793491300 },
  { ...openPull, open: false, closedAt: 1793491300 }, { ...openPull, open: false, closedAt: 0 },
  { ...openPull, open: false, closedAt: 1793491300, appealOpen: true },
  { ...openPull, open: false, closedAt: 1793491300, appealUpheldAt: 1794600000 },
  { ...openPull, open: false, closedAt: 1793491300, invited: InvitedWork },
  { ...openPull, open: false, closedAt: 1793491300, invited: InvitedWork, keepMarked: true, keepMarkedAt: 1793491400 },
  { ...openPull, open: false, closedAt: 1793491300, invited: InvitedWork, keepMarked: true, keepMarkedAt: 1794900000 },
  { ...openPull, open: false, closedAt: 1793491300, invited: InvitedWork, keepMarked: true, keepMarkedAt: 0 },
  { ...openPull, open: false, closedAt: 1793491300, invited: LinkUnread },
  { ...openPull, open: false, closedAt: 1794700800 }, { ...openPull, open: false, closedAt: 1794700801 },
  { ...openPull, open: false, closedAt: 1794700801, appealOpen: true },
  { ...openPull, open: false, closedAt: 1794700801, appealUpheldAt: 1794800000 },
  { ...openPull, open: false, closedAt: 1794700801, invited: InvitedWork, keepMarked: true, keepMarkedAt: 1794700900 },
  { ...openPull, open: false, closedAt: 1794700801, invited: InvitedWork, keepMarked: true, keepMarkedAt: 0 },
  { ...openPull, open: false, closedAt: 1794700801, invited: LinkUnread },
  { ...openPull, draft: true }, { ...openPull, contributorScope: false }, { ...openPull, installationActive: false })
pure val wantedAdded: LabelEvent = { label: M::wantedLabelName, added: true, at: 3 }
pure val eValues = Set(wantedAdded, { ...wantedAdded, at: 5 }, { ...wantedAdded, at: 7 }, { ...wantedAdded, added: false },
  { ...wantedAdded, label: "other" }, { ...wantedAdded, at: -1 })
pure val openedValues = Set(4, 5, 6)
pure val issueValues = Set({ ownRepository: true, events: List(wantedAdded) }, { ownRepository: false, events: List(wantedAdded) },
  { ownRepository: true, events: List(wantedAdded, { ...wantedAdded, added: false, at: 4 }) },
  { ownRepository: true, events: List() })
pure val commentIdValues = Set(41, 0)
pure val paidAtValues = Set(1793491200, 0)
pure val secondsValues = Set(60, 600, 86400, 604800, 1209600)
pure val nowValues = Set(1793491200, 1794700800, 1795000000)
pure val askedItem: FeeItem = { present: true, paid: false, paidAt: 0, amountMinor: 2000000, settlement: NoSettlement }
pure val gValues = Set(initial, { ...initial, gate: Recorded, updatedAt: 1793491200 },
  { ...initial, gate: Asking, updatedAt: 1793491200, feeItem: askedItem },
  { ...initial, gate: Asked, commentId: 41, labelNeeded: true, updatedAt: 1793491200, feeItem: askedItem },
  { ...initial, gate: Paid, commentId: 41, labelPaid: true, updatedAt: 1793491200,
    feeItem: { ...askedItem, paid: true, paidAt: 1793491200 } },
  { ...initial, gate: Released, commentId: 41, updatedAt: 1793491200 })
pure val weight_claimAsk = 2
pure val weight_confirmAsk = 2
pure val weight_observePaid = 2
pure val weight_refreshPaid = 2
pure val eval_witness_sometimesReleasedReviewQueued = (
  ("claimAsk", liveFacts),
  ("confirmAsk", 41),
  ("releaseChecked", { ...liveFacts, feeSetting: S::feeSettingAbsent, settingSince: 0 }, openPull, 41)
)
pure val eval_witness_sometimesAskedAgain = (
  ("claimAsk", liveFacts),
  ("confirmAsk", 41),
  ("observePaid", 1793491200),
  ("refreshPaid", liveFacts, openPull, 41),
  "observeWithdrawn",
  ("askAgain", liveFacts, openPull, 41)
)
pure val eval_witness_sometimesRefunded = (
  ("claimAsk", liveFacts),
  ("confirmAsk", 41),
  ("observePaid", 1793491200),
  ("elapse", 1209600),
  ("refreshPaid", liveFacts, { ...openPull, open: false, closedAt: 1793491300 }, 41),
  "reopenKept",
  ("refreshPaid", liveFacts, { ...openPull, open: false, merged: true, closedAt: 1793491300 }, 41),
  ("observeSettled", Refunded)
)
```

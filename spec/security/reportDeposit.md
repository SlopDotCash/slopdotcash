# Refundable report deposit

PRD section 8, "Report deposit" (operator decision of 21 November 2026; PRD
section 6, FEE-07), development commits `c04752ccf` and `a381f7591`
(`backend/security/report-deposit.ts`, `report-deposit-hold.ts`,
`src/lib/security-report-deposit.mjs`, migration
`0145_security_report_deposits.sql`, legacy model
`formal/models/api/api_security_report_deposit.qnt`). A report filed through
Slop needs a deposit of SLOP on Robinhood Chain worth 5 US dollars at Slop's
published SLOP rate. It is sent back unless the report is closed as spam, a
duplicate or out of scope and that close stands for seven days; a kept
deposit goes to the burn address. This machine holds one report's
[case](./cases.md), its [screening](./screening.md) and its deposit row, and
keeps the case's and the screening's `depositHeld` equal to the row. The
security API asks, releases and decides; it moves no money and holds no key.
The submission-fee side ([report deposits on chain](../fees/submissionFeeReportDeposits.md)) records the
payment from confirmed chain evidence, clears it again when a reorganisation
removes that deposit before it is final, and records the final refund, burn or
the payer's own reclaim from finalized chain evidence; it never decides what
is due. The row holds no reporter, title or report text.

## Story: Hold a private report until its refundable deposit is recorded

> As a program owner, I want reports filed through Slop to carry a small
> refundable deposit, so that spam and duplicates cost their sender and real
> reports cost nothing.

### A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt

`SECURITY_REPORT_DEPOSIT` is `off`, `dry_run` or `live`; any other value is
off (`reportDepositMode`). Production runs `live` since 21 November 2026
(record-only earlier that day) and staging `off`; the browser's
`REPORT_DEPOSIT_SWITCHED_ON` changes only together with it. One row is
written in the batch that creates the case, and only when the case was
created at that instant and has no row (`reportDepositAsk`): a report saved
on Slop, a reporter's claim of a GitHub report, and a GitHub report the
reporter links that had no case. A maintainer's import or record asks
nobody, and a case that exists already never gets a row. Nobody is asked
while the mode is off, when the project's manifest sets
`security.reportDeposit` to `false` (absent is on), when no SLOP rate is in
force, or when the reporter is exempt: a Slop moderator or admin, the
project's steward, a named technical, financial or dispute approver of its
program, an account that published a revision of the project or applied for
it, or an account with current write, maintain or admin access to its first
repository (an unreadable GitHub counts as no access). `live` writes an
asked row; `dry_run` writes a recorded row that asks nobody, holds nothing
and is never touched again. The amount is fixed at the ask: SLOP base units
`ceil(5,000,000 × rate scaled to 10^18 / (10^6 × 10^18)) × 10^18`, a whole
SLOP rounded up (`reportDepositAmount`, exact integer arithmetic in the shell,
beyond 2^53). Its item is
`keccak256(abi.encodePacked("slop-report-v1", caseId))`. A failed read of the
rate or the project asks nobody and the report proceeds; the failure is
logged by name only. The shell computes the exemption and the rate in force
itself and sends the receipt as the security API (`depositService`), never
from a request. This machine follows a report saved on Slop; a reporter's
claim of a GitHub report is asked in the same batch in the same way while the
[case](./cases.md) is still claimed.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import screening as S from "./screening"
import cases as C from "./cases"
import routineDecisions as RD from "./routineDecisions"
type DepositMode = DepositOff | DepositDryRun | DepositLive
type DepositRow = NoRow | Asked | Recorded
type DepositOutcome = NoOutcome | RefundDue | KeptDue | Refunded | Kept
type DepositReason = NoReason | Responded | Silent | TurnedOff | SpamClose | DuplicateClose | OutOfScopeClose
type Deposit = { row: DepositRow, paid: bool, paidAt: int, outcome: DepositOutcome, reason: DepositReason }
type ReportDeposit = { mode: DepositMode, projectOn: bool, nowMs: int, privateCase: C::PrivateCase, screening: S::Screening,
  deposit: Deposit, closedAt: int, requestedAtVersion: int, savedAt: int }
pure val depositService = -3
pure val feeRecorder = -4
pure val noDeposit: Deposit = { row: NoRow, paid: false, paidAt: 0, outcome: NoOutcome, reason: NoReason }
pure val initial: ReportDeposit = { mode: DepositLive, projectOn: true, nowMs: T::standardTerms.receivedAt,
  privateCase: { ...C::initial, authority: C::staff }, screening: S::initial, deposit: noDeposit, closedAt: 0, requestedAtVersion: 0,
  savedAt: T::standardTerms.receivedAt }
pure def held(d: Deposit): bool = d.row == Asked and not(d.paid) and d.outcome == NoOutcome
pure def synced(d: Deposit, r: ReportDeposit): ReportDeposit =
  { ...r, deposit: d, privateCase: C::withDepositHeld(held(d), r.privateCase), screening: S::withDepositHeld(held(d), r.screening) }
pure def asks(r: ReportDeposit, exempt: bool, rated: bool): bool = r.mode != DepositOff and r.projectOn and rated and not(exempt)
pure def canReceive(r: ReportDeposit, by: int, exempt: bool, rated: bool): bool = by == depositService
  and C::canReceive(r.privateCase, C::SlopReceived, T::standardTerms, C::NewReceipt, M::zero, 1)
pure def receive(r: ReportDeposit, by: int, exempt: bool, rated: bool): ReportDeposit =
  val row = if (not(asks(r, exempt, rated))) NoRow else if (r.mode == DepositLive) Asked else Recorded
  synced({ ...noDeposit, row: row },
    { ...r, privateCase: C::receive(r.privateCase, C::SlopReceived, T::standardTerms, C::NewReceipt, M::zero, 1), savedAt: r.nowMs })
pure def canSetMode(r: ReportDeposit, by: int, mode: DepositMode): bool = by == depositService and mode != r.mode
pure def setMode(r: ReportDeposit, by: int, mode: DepositMode): ReportDeposit = { ...r, mode: mode }
pure def canObserveProjectSetting(r: ReportDeposit, by: int, on: bool): bool = by == depositService and on != r.projectOn
pure def observeProjectSetting(r: ReportDeposit, by: int, on: bool): ReportDeposit = { ...r, projectOn: on }
pure def canAdvance(r: ReportDeposit, ms: int): bool = ms > 0
pure def advance(r: ReportDeposit, ms: int): ReportDeposit = { ...r, nowMs: r.nowMs + ms }
pure def alwaysRowOnlyForACreatedCase(r: ReportDeposit): bool =
  r.deposit.row != NoRow implies r.privateCase.submission != C::NotReceived
pure def stepAskOnlyAtCreation(before: ReportDeposit, via: str, after: ReportDeposit): bool =
  ((before.deposit.row == NoRow and after.deposit.row != NoRow) implies via == "receive"
    and before.privateCase.submission == C::NotReceived and before.mode != DepositOff)
  and ((before.deposit.row == NoRow and after.deposit.row == Asked) implies before.mode == DepositLive)
  and (before.deposit.row != NoRow implies after.deposit.row != NoRow)
  and (before.deposit.row == Recorded implies after.deposit.row == Recorded)
pure def sometimesAsked(r: ReportDeposit): bool = r.deposit.row == Asked and r.privateCase.submission == C::Verified
pure def sometimesRecordOnly(r: ReportDeposit): bool = r.deposit.row == Recorded and r.deposit.reason == NoReason
  and r.screening.revision > 1
pure def sometimesExemptNotAsked(r: ReportDeposit): bool = r.deposit.row == NoRow and r.privateCase.submission == C::Verified
  and r.mode == DepositLive
```

### A report that waits for its deposit belongs to its reporter alone

An asked row with no payment and no outcome holds the report (`depositHeld`,
the one condition every caller checks). While it holds, the report is not
screened, assessed, routed, notified, listed or counted for anyone else, the
routine pass does not read it, no person verifies, triages, decides or reads
it (not found), it is never an earlier report or a digest duplicate of
another, and screening retry and GitHub forwarding refuse with 409
`deposit_required` ("This report waits for its deposit. Nothing else happens
to it until the deposit is recorded."). The reporter reads it, sees
"Deposit needed" with the pay page `/fee/report/<case>`, and may add a
version. The fee side marks a deposit paid, and may clear the payment again
while no outcome is set (a reorganised block); the report then waits again.
A recorded row never holds. The routine pass decides only a report it can
read: settled screening and a routine-readable case, as in
[routine decisions](./routineDecisions.md), where screening still queued or
running settles 15 minutes after the last write to the case.

```quint
pure def canPay(r: ReportDeposit, by: int): bool = by == feeRecorder and r.deposit.row == Asked and not(r.deposit.paid)
  and r.deposit.outcome == NoOutcome
pure def pay(r: ReportDeposit, by: int): ReportDeposit = synced({ ...r.deposit, paid: true, paidAt: r.nowMs }, r)
pure def canUnpay(r: ReportDeposit, by: int): bool = by == feeRecorder and r.deposit.row == Asked and r.deposit.paid
  and r.deposit.outcome == NoOutcome
pure def unpay(r: ReportDeposit, by: int): ReportDeposit = synced({ ...r.deposit, paid: false, paidAt: 0 }, r)
pure def epoch(r: ReportDeposit): int = r.privateCase.authority.epoch
pure def canClaimScreening(r: ReportDeposit): bool = r.privateCase.submission == C::Verified
  and S::canClaim(r.screening, r.screening.revision, r.nowMs, true)
pure def claimScreening(r: ReportDeposit): ReportDeposit = { ...r, screening: S::claim(r.screening, r.screening.revision, r.nowMs, true) }
pure def canReviewReport(r: ReportDeposit, by: int, review: S::Review): bool = r.privateCase.submission == C::Verified
  and S::canReviewReport(r.screening, by, r.screening.revision, review, C::technicalNow(r.privateCase, by, epoch(r)), true)
pure def reviewReport(r: ReportDeposit, by: int, review: S::Review): ReportDeposit =
  { ...r, screening: S::reviewReport(r.screening, by, r.screening.revision, review, C::technicalNow(r.privateCase, by, epoch(r)), true) }
pure def revisionEvidence(r: ReportDeposit, by: int): S::RevisionEvidence = { isReporter: by == r.privateCase.reporter,
  draftOrFailed: true, noAdvisory: true, caseNeedsInformation: r.privateCase.receipt == C::NeedsInformation,
  exactCaseCas: true, allowedCaseState: C::canReviseReport(r.privateCase, by, r.screening.version + 1),
  exactObjectStored: true, admitted: true }
pure def canSaveVersion(r: ReportDeposit, by: int, digest: str): bool =
  S::canReplace(r.screening, r.screening.revision, digest, revisionEvidence(r, by))
pure def saveVersion(r: ReportDeposit, by: int, digest: str): ReportDeposit =
  { ...r, screening: S::replace(r.screening, r.screening.revision, digest, revisionEvidence(r, by)),
    privateCase: C::reviseReport(r.privateCase, by, r.screening.version + 1), savedAt: r.nowMs }
pure def canRequestInformation(r: ReportDeposit, by: int): bool = C::canRequestInformation(r.privateCase, by, epoch(r))
pure def requestInformation(r: ReportDeposit, by: int): ReportDeposit =
  { ...r, privateCase: C::requestInformation(r.privateCase, by, epoch(r)), requestedAtVersion: r.privateCase.reportVersion,
    savedAt: r.nowMs }
pure def canDecide(r: ReportDeposit, by: int, decision: C::Decision): bool =
  C::canDecide(r.privateCase, by, epoch(r), r.privateCase.reportVersion, decision)
pure def decide(r: ReportDeposit, by: int, decision: C::Decision): ReportDeposit =
  { ...r, privateCase: C::decide(r.privateCase, by, epoch(r), r.privateCase.reportVersion, decision), closedAt: r.nowMs,
    savedAt: r.nowMs }
pure def canRoutineDecide(r: ReportDeposit, by: int, ruling: C::RoutineOutcome): bool = by == C::routineService
  and RD::screeningSettledFor(r.screening, r.savedAt, r.nowMs) and C::routineOutcomeAllowed(r.privateCase, ruling, 7, r.nowMs)
pure def routineDecide(r: ReportDeposit, by: int, ruling: C::RoutineOutcome): ReportDeposit =
  { ...r, privateCase: C::routineDecided(ruling, r.privateCase, 7, r.nowMs),
    closedAt: if (ruling == C::RoutineDuplicate or ruling == C::RoutineOutOfScope or ruling == C::RoutineNoProof) r.nowMs else r.closedAt,
    savedAt: r.nowMs }
pure def canAppeal(r: ReportDeposit, by: int): bool = C::routineAppealable(r.privateCase, by) or C::canAppeal(r.privateCase, by)
pure def appeal(r: ReportDeposit, by: int): ReportDeposit =
  { ...r, privateCase: if (C::routineAppealable(r.privateCase, by)) C::routineReturned(by, r.privateCase) else C::appeal(r.privateCase, by),
    savedAt: r.nowMs }
pure def canDecideAppeal(r: ReportDeposit, by: int, uphold: bool): bool = C::canDecideAppeal(r.privateCase, by, epoch(r), uphold)
pure def decideAppeal(r: ReportDeposit, by: int, uphold: bool): ReportDeposit =
  { ...r, privateCase: C::decideAppeal(r.privateCase, by, epoch(r), uphold), closedAt: r.nowMs, savedAt: r.nowMs }
pure def alwaysHeldMirrored(r: ReportDeposit): bool =
  r.privateCase.depositHeld == held(r.deposit) and r.screening.depositHeld == held(r.deposit)
pure def alwaysRecordedNeverHolds(r: ReportDeposit): bool =
  r.deposit.row != Asked implies not(r.deposit.paid) and r.deposit.outcome == NoOutcome
pure def stepNothingStartsWhileHeld(before: ReportDeposit, via: str, after: ReportDeposit): bool = held(before.deposit) implies
  not(via == "claimScreening" or via == "reviewReport" or via == "requestInformation" or via == "decide"
    or via == "routineDecide" or via == "decideAppeal")
pure def sometimesHeld(r: ReportDeposit): bool = held(r.deposit) and r.privateCase.submission == C::Verified
pure def sometimesHeldReportRevised(r: ReportDeposit): bool = held(r.deposit) and r.privateCase.reportVersion > 1
pure def sometimesPaidAndScreened(r: ReportDeposit): bool = r.deposit.paid and r.screening.phase == S::Running
```

### Unpaid asks are released when the switch or the project turns the deposit off

A bounded sweep runs behind security API requests, at most once every 30
seconds per isolate, after the response (`sweepReportDeposits`), and its
failure is logged by name and never reaches the response. It turns every
unpaid asked row into a recorded one, with reason turned-off and the time
and no outcome, when the mode is not `live`, and otherwise those of a project
whose owner turned the deposit off (`releaseUnpaid`); a row the fee side
marked paid in the same moment stays asked and is sent back below. It then
starts at most 3 held works whose row is paid or released (never a row that
record-only mode wrote): the screening of a saved report still queued with
no review, or the owner notice keyed by the receipt event and the analysis
of a report linked from GitHub that has neither yet (`startReleasedWork`).
Each start is safe to repeat. A reporter's claim that GitHub has not
confirmed yet has no analysis to start, but its owner notice waited too
(development pull request 3226, migration
`0155_security_report_deposit_claim_notice.sql` there, `0204` here). The same
sweep tries the notice of at most 3 such claims whose row is paid or
released: the notice the claim would have written without a deposit, keyed by
its `claim` event. A try that told the owners, or found nobody to tell (no
program, a project that is unknown or retired, or no technical recipient
other than the reporter), is recorded on the row (`claim_notice_at`) and that
claim is never tried again; a claim GitHub confirms later is told by its
`receive` event. A try that failed, because the owners' authority could not
be read or for any other error, is not recorded as tried: only its time is
kept (`claim_retry_at`), it is logged by name unless the authority was
unavailable, and the sweep takes claims with no failed try first and then
the one whose failed try is oldest, so a failure that lasts cannot hold the
three places (`claimNoticeAfter`).

```quint
pure def turnedOff(r: ReportDeposit): bool = r.mode != DepositLive or not(r.projectOn)
pure def canRelease(r: ReportDeposit, by: int): bool = by == depositService and held(r.deposit) and turnedOff(r)
pure def release(r: ReportDeposit, by: int): ReportDeposit = synced({ ...r.deposit, row: Recorded, reason: TurnedOff }, r)
pure def stepReleaseOnlyWhenTurnedOff(before: ReportDeposit, via: str, after: ReportDeposit): bool =
  (before.deposit.row == Asked and after.deposit.row == Recorded) implies via == "release" and turnedOff(before)
    and not(before.deposit.paid) and after.deposit.reason == TurnedOff and after.deposit.outcome == NoOutcome
pure def sometimesReleased(r: ReportDeposit): bool = r.deposit.row == Recorded and r.deposit.reason == TurnedOff
pure def sometimesReleasedAndScreened(r: ReportDeposit): bool = r.deposit.reason == TurnedOff and r.screening.phase == S::Running
type ClaimTry = OwnersTold | NobodyToTell | TryFailed
type ClaimNotice = { triedAt: int, retriedAt: int }
pure val noClaimTry: ClaimNotice = { triedAt: 0, retriedAt: 0 }
pure def claimNoticeAfter(notice: ClaimNotice, result: ClaimTry, nowMs: int): ClaimNotice =
  if (notice.triedAt > 0) notice
  else if (result == TryFailed) { ...notice, retriedAt: nowMs }
  else { ...notice, triedAt: nowMs }
pure def lawFailedClaimTryIsNotRecorded(notice: ClaimNotice, result: ClaimTry, nowMs: int): bool =
  result == TryFailed implies claimNoticeAfter(notice, result, nowMs).triedAt == notice.triedAt
pure def lawEndedClaimTryIsRecorded(notice: ClaimNotice, result: ClaimTry, nowMs: int): bool =
  (result != TryFailed and notice.triedAt == 0) implies
    claimNoticeAfter(notice, result, nowMs) == { ...notice, triedAt: nowMs }
pure def lawRecordedClaimTryIsFinal(notice: ClaimNotice, result: ClaimTry, nowMs: int): bool =
  notice.triedAt > 0 implies claimNoticeAfter(notice, result, nowMs) == notice
```

### A paid deposit is sent back on a first response and kept only after a keeping close stood seven days

The same sweep reads at most 500 paid asked rows with no outcome, oldest
payment first, and sets an outcome from the report's stored state
(`reportDepositOutcome`). Sent back: the mode is not `live` or the project
turned the deposit off; the report got a first response that is not a
keeping close (a maintainer's routing approval while it is received, a
person's request for information the reporter answered with a newer version,
in triage unless an appeal returned it to the owner, confirmed, or any
rejection without a person's spam mark, the routine "no proof received"
close included); or 14 days passed after payment with the report still
received. Kept: the report is closed as a duplicate, out of scope, or
rejected by a person who marked it spam (never by the routine pass's actor),
the latest decision or appeal decision on it is 7 days old and no appeal is
open. An open appeal, the routine pass's own request for proof and a report
an appeal returned to the owner wait. A kept outcome is written only while
the case is still at the revision that was read, so a concurrent appeal
wins. The fee side then sends the refund or the burn and records refunded or
kept. A payer may also reclaim a paid deposit from the contract after 30 days,
whatever its row says: the fee side then records it refunded, from no outcome
or from either due outcome, and the reason stays as it was. Only a kept-due
row is ever burned. An outcome is set once and then only becomes final.

```quint
type DepositFacts = { mode: DepositMode, projectOn: bool, paidAt: int, receipt: C::Receipt, appeal: C::AppealState,
  routineRequest: bool, routed: bool, requestAnswered: bool, closedAt: int, spamByPerson: bool }
type Due = { outcome: DepositOutcome, reason: DepositReason }
pure val refundSilentMs = 1209600000
pure val keptAfterClosedMs = 604800000
pure val waits: Due = { outcome: NoOutcome, reason: NoReason }
pure def refund(reason: DepositReason): Due = { outcome: RefundDue, reason: reason }
pure def keptIfStood(facts: DepositFacts, nowMs: int, reason: DepositReason): Due =
  if (facts.appeal != C::AppealOpen and facts.closedAt > 0 and nowMs >= facts.closedAt + keptAfterClosedMs)
    { outcome: KeptDue, reason: reason } else waits
pure def depositOutcome(facts: DepositFacts, nowMs: int): Due =
  if (facts.mode != DepositLive or not(facts.projectOn)) refund(TurnedOff)
  else if (facts.receipt == C::Received)
    (if (facts.routed) refund(Responded) else if (nowMs >= facts.paidAt + refundSilentMs) refund(Silent) else waits)
  else if (facts.receipt == C::NeedsInformation)
    (if (not(facts.routineRequest) and facts.requestAnswered) refund(Responded) else waits)
  else if (facts.receipt == C::Triaging) (if (facts.appeal == C::Returned) waits else refund(Responded))
  else if (facts.receipt == C::Confirmed) refund(Responded)
  else if (facts.receipt == C::Duplicate) keptIfStood(facts, nowMs, DuplicateClose)
  else if (facts.receipt == C::OutOfScope) keptIfStood(facts, nowMs, OutOfScopeClose)
  else if (facts.receipt == C::Rejected) (if (facts.spamByPerson) keptIfStood(facts, nowMs, SpamClose) else refund(Responded))
  else waits
pure def factsOf(r: ReportDeposit): DepositFacts = { mode: r.mode, projectOn: r.projectOn, paidAt: r.deposit.paidAt,
  receipt: r.privateCase.receipt, appeal: r.privateCase.appeal, routineRequest: r.privateCase.routine.proofDueAt > 0,
  routed: r.screening.review == S::Forward,
  requestAnswered: r.requestedAtVersion > 0 and r.privateCase.reportVersion > r.requestedAtVersion,
  closedAt: r.closedAt, spamByPerson: r.privateCase.spamMarked }
pure def canDecideOutcome(r: ReportDeposit, by: int): bool = by == depositService and r.deposit.row == Asked and r.deposit.paid
  and r.deposit.outcome == NoOutcome and depositOutcome(factsOf(r), r.nowMs).outcome != NoOutcome
pure def decideOutcome(r: ReportDeposit, by: int): ReportDeposit =
  val due = depositOutcome(factsOf(r), r.nowMs)
  synced({ ...r.deposit, outcome: due.outcome, reason: due.reason }, r)
pure def canRecordSent(r: ReportDeposit, by: int, burned: bool): bool = by == feeRecorder and r.deposit.row == Asked
  and r.deposit.paid and r.deposit.outcome != Refunded and r.deposit.outcome != Kept
  and (burned implies r.deposit.outcome == KeptDue)
pure def recordSent(r: ReportDeposit, by: int, burned: bool): ReportDeposit =
  synced({ ...r.deposit, outcome: if (burned) Kept else Refunded }, r)
pure def keepingClose(r: ReportDeposit): bool = r.privateCase.receipt == C::Duplicate or r.privateCase.receipt == C::OutOfScope
  or (r.privateCase.receipt == C::Rejected and r.privateCase.spamMarked)
pure def lawNoModelKeeps(facts: DepositFacts, nowMs: int): bool =
  depositOutcome(facts, nowMs).outcome == KeptDue implies facts.mode == DepositLive and facts.projectOn
    and facts.appeal != C::AppealOpen and facts.closedAt > 0 and nowMs >= facts.closedAt + keptAfterClosedMs
    and (facts.receipt == C::Duplicate or facts.receipt == C::OutOfScope or (facts.receipt == C::Rejected and facts.spamByPerson))
pure def lawTurnedOffSendsBack(facts: DepositFacts, nowMs: int): bool =
  (facts.mode != DepositLive or not(facts.projectOn)) implies depositOutcome(facts, nowMs) == refund(TurnedOff)
pure def lawOpenAppealWaits(facts: DepositFacts, nowMs: int): bool =
  (facts.mode == DepositLive and facts.projectOn and facts.receipt == C::Disputed) implies depositOutcome(facts, nowMs) == waits
pure def alwaysOutcomeOnlyOnPaidAsk(r: ReportDeposit): bool =
  r.deposit.outcome != NoOutcome implies r.deposit.row == Asked and r.deposit.paid
pure def alwaysKeptOnlyOnKeepingClose(r: ReportDeposit): bool =
  (r.deposit.outcome == KeptDue or r.deposit.outcome == Kept) implies
    (r.deposit.reason == SpamClose or r.deposit.reason == DuplicateClose or r.deposit.reason == OutOfScopeClose)
pure def stepKeptOnlyAfterTheCloseStood(before: ReportDeposit, via: str, after: ReportDeposit): bool =
  (after.deposit.outcome == KeptDue and before.deposit.outcome != KeptDue) implies via == "decideOutcome"
    and before.mode == DepositLive and before.projectOn and keepingClose(before) and before.privateCase.appeal != C::AppealOpen
    and before.closedAt > 0 and before.nowMs >= before.closedAt + keptAfterClosedMs
pure def stepOutcomeOnce(before: ReportDeposit, after: ReportDeposit): bool =
  before.deposit.outcome != NoOutcome implies after.deposit.reason == before.deposit.reason and after.deposit.paid
    and (after.deposit.outcome == before.deposit.outcome
      or (before.deposit.outcome == RefundDue and after.deposit.outcome == Refunded)
      or (before.deposit.outcome == KeptDue and (after.deposit.outcome == Kept or after.deposit.outcome == Refunded)))
pure def stepBurnedOnlyWhenKeptDue(before: ReportDeposit, after: ReportDeposit): bool =
  (after.deposit.outcome == Kept and before.deposit.outcome != Kept) implies before.deposit.outcome == KeptDue
pure def stepOnlyTheFeeSideRecordsMoney(before: ReportDeposit, via: str, after: ReportDeposit): bool =
  (after.deposit.paid != before.deposit.paid implies via == "pay" or via == "unpay")
  and ((after.deposit.outcome != before.deposit.outcome and (after.deposit.outcome == Refunded or after.deposit.outcome == Kept))
    implies via == "recordSent")
pure def sometimesRefundedAfterResponse(r: ReportDeposit): bool = r.deposit.outcome == Refunded and r.deposit.reason == Responded
pure def sometimesSentBackWhenSilent(r: ReportDeposit): bool = r.deposit.outcome == RefundDue and r.deposit.reason == Silent
pure def sometimesNoProofCloseSentBack(r: ReportDeposit): bool = r.deposit.outcome == RefundDue and r.deposit.reason == Responded
  and r.privateCase.receipt == C::Rejected and r.privateCase.routine.closed
pure def sometimesDuplicateKept(r: ReportDeposit): bool = r.deposit.outcome == Kept and r.deposit.reason == DuplicateClose
pure def sometimesSpamKept(r: ReportDeposit): bool = r.deposit.outcome == KeptDue and r.deposit.reason == SpamClose
pure def sometimesPaidThenTurnedOffSentBack(r: ReportDeposit): bool = r.deposit.outcome == RefundDue and r.deposit.reason == TurnedOff
pure def sometimesReclaimedBeforeAnOutcome(r: ReportDeposit): bool = r.deposit.outcome == Refunded and r.deposit.reason == NoReason
```

### Simulation samples

Actor 1 is the reporter, 2 a technical approver, 4 a moderator, -2 the
routine pass, -3 the security API's own steps and -4 the fee side. The facts
cover every receipt state with and without a spam mark, routing, a routine
request, an answered request, an open or returned appeal, and the switch or
the project off; the instants sit on either side of the 7- and 14-day bounds.
The claim notices are one never tried, one whose try failed, and two already
recorded, each with every result of a try.

```quint
pure val byValues = Set(-4, -3, -2, 1, 2, 4)
pure val exemptValues = Set(true, false)
pure val ratedValues = Set(true, false)
pure val onValues = Set(true, false)
pure val msValues = Set(900000, 604800000, 1209600000)
pure val digestValues = Set("revised", "again")
pure val reviewValues = Set(S::Forward, S::RequestInformation)
pure val upholdValues = Set(true, false)
pure val burnedValues = Set(true, false)
pure val modeValues = Set(DepositOff, DepositDryRun, DepositLive)
pure val decisionValues = Set(
  { finding: C::Confirmed, severity: T::High, loss: T::NotVerified, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: false, spam: false },
  { finding: C::Duplicate, severity: T::SeverityUnset, loss: T::LossUnset, inScope: true, rootCause: 1, duplicateOf: 9, declareRelated: false, spam: false },
  { finding: C::Rejected, severity: T::SeverityUnset, loss: T::LossUnset, inScope: false, rootCause: 0, duplicateOf: 0, declareRelated: false, spam: false },
  { finding: C::Rejected, severity: T::SeverityUnset, loss: T::LossUnset, inScope: false, rootCause: 0, duplicateOf: 0, declareRelated: false, spam: true })
pure val baseFacts: DepositFacts = { mode: DepositLive, projectOn: true, paidAt: 1, receipt: C::Received, appeal: C::NoAppeal,
  routineRequest: false, routed: false, requestAnswered: false, closedAt: 1, spamByPerson: false }
pure val factsValues = Set(C::Received, C::NeedsInformation, C::Triaging, C::Confirmed, C::Duplicate, C::OutOfScope, C::Rejected, C::Disputed)
  .fold(Set(), (acc, receipt) => acc.union(Set(
    { ...baseFacts, receipt: receipt },
    { ...baseFacts, receipt: receipt, spamByPerson: true, appeal: C::Returned },
    { ...baseFacts, receipt: receipt, spamByPerson: true, routed: true, requestAnswered: true, appeal: C::AppealOpen },
    { ...baseFacts, receipt: receipt, routineRequest: true, requestAnswered: true },
    { ...baseFacts, receipt: receipt, mode: DepositDryRun },
    { ...baseFacts, receipt: receipt, projectOn: false, spamByPerson: true })))
pure val nowMsValues = Set(1, 604800000, 604800001, 1209600001)
pure val noticeValues = Set(noClaimTry, { triedAt: 0, retriedAt: 1 }, { triedAt: 1, retriedAt: 0 }, { triedAt: 604800000, retriedAt: 1 })
pure val resultValues = Set(OwnersTold, NobodyToTell, TryFailed)
pure val weight_pay = 6
pure val weight_advance = 6
pure val weight_decideOutcome = 8
pure val weight_recordSent = 4
pure val weight_routineDecide = 6
pure val weight_decide = 6
```

# Submission fee deposits of security reports

PRD section 8 (operator decision of 21 November 2026; #3196, #3203): a
private security report may ask its reporter for a refundable deposit of
SLOP on Robinhood Chain, made into the same `SubmissionDeposits` contract
and read by the same submission-fee Worker as a pull request's
[deposit](./submissionFeeDeposits.md). The security area writes the
report's row in `security_report_deposits`, `asked` when a deposit is needed
or `recorded` when record-only mode wrote it, fixes the SLOP amount asked,
and decides `refund_due` or `kept_due` on a paid row; this spec is the chain
side only: judging a deposit that names an asked row, marking the row paid,
sending what the row says and writing its final outcome. Sources at Slop
development `8660a6121`: `workers/submission-fee/report.ts`
(`reportDepositCounts`, `reportResolveAction`), `core.ts` (`judge`, `plan`),
`store.ts` (`reportByHash`, `markReportPaid`, `resolvable`), migration
`0145_security_report_deposits.sql` and development's own model
`formal/models/fees/submission_fee_report_deposit.qnt`.

A deposit whose item no pull request has is looked up among the asked
report rows only; a `recorded` row asks for nothing, so a deposit naming one
is an unknown item like any other, judged by the pull request rule. The
Worker's logs name a report's deposit by its network and deposit id only,
never the case, and nothing here reads the report's title, text, project or
reporter. The chain record, confirmation, finality, reorganisation and
reclaim are those of the pull request's deposit, composed here.

## Story: Take a reporter's deposit only as burned SLOP for the report that asked it

> As a security reporter, I want my deposit to pay for my report only when
> it is the SLOP amount the report asked, kept only by burning it when the
> report is judged in bad faith, and returned to me otherwise.

### A deposit pays a report only as SLOP to the burn address on Robinhood Chain for an asked row

The judgement of a deposit that names an asked row checks, in this order:
the token is in the network's table (`token_not_accepted`), the network is
Robinhood Chain (`report_wrong_network`), the token is SLOP
(`report_token_not_slop`), the kept destination is the burn address
(`wrong_kept_to`), the row exists (`unknown_item`), the row's SLOP amount is
a positive base-unit amount (`report_amount_invalid`), the deposit is at
least that amount (`amount_below_due`), no other deposit paid the row
(`item_already_paid`) and the security area has not decided it unless this
deposit paid it (`item_already_decided`). Acceptance first marks the row
paid, only while its mode is still `asked` and it is unpaid and undecided or
already paid by this very deposit, and only then records the deposit as
accepted. A deposit the chain reorganises away unpays its row while the row
has no outcome. A deposit naming no asked row waits a day after it is
finalized and is then refused; one of a token outside the table, or with a
destination its kind does not allow, is refused at once.

```quint
import submissionFeeDeposits as D from "./submissionFeeDeposits"
import submissionFeeTerms as T from "../backend/submissionFeeTerms"
type ReportMode = NoReport | AskedReport | RecordedReport
type ReportFacts = { kind: T::TokenKind, robinhood: bool, keptToBurn: bool, rowAsked: bool, amountValid: bool, paidAtLeastDue: bool,
  paidBy: D::PaidBy, decided: bool }
pure def reportVerdict(reportFacts: ReportFacts): D::Refusal =
  if (reportFacts.kind == T::NoToken) D::TokenNotAccepted
  else if (not(reportFacts.robinhood)) D::ReportWrongNetwork
  else if (reportFacts.kind != T::SlopToken) D::ReportTokenNotSlop
  else if (not(reportFacts.keptToBurn)) D::WrongKeptTo
  else if (not(reportFacts.rowAsked)) D::UnknownItem
  else if (not(reportFacts.amountValid)) D::ReportAmountInvalid
  else if (not(reportFacts.paidAtLeastDue)) D::AmountBelowDue
  else if (reportFacts.paidBy == D::OtherDeposit) D::ItemAlreadyPaid
  else if (reportFacts.paidBy != D::ThisDeposit and reportFacts.decided) D::ItemAlreadyDecided
  else D::NoRefusal
pure def lawReportPaidOnlyByBurnedSlop(reportFacts: ReportFacts): bool = reportVerdict(reportFacts) == D::NoRefusal implies
  (reportFacts.kind == T::SlopToken and reportFacts.robinhood and reportFacts.keptToBurn and reportFacts.rowAsked
    and reportFacts.amountValid and reportFacts.paidAtLeastDue and reportFacts.paidBy != D::OtherDeposit)
pure val reportFactsValues = Set(
  { kind: T::SlopToken, robinhood: true, keptToBurn: true, rowAsked: true, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::StableToken, robinhood: true, keptToBurn: false, rowAsked: true, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, robinhood: false, keptToBurn: true, rowAsked: true, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, robinhood: true, keptToBurn: true, rowAsked: true, amountValid: false, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, robinhood: true, keptToBurn: true, rowAsked: true, amountValid: true, paidAtLeastDue: true, paidBy: D::OtherDeposit, decided: true },
  { kind: T::SlopToken, robinhood: true, keptToBurn: true, rowAsked: true, amountValid: true, paidAtLeastDue: true, paidBy: D::ThisDeposit, decided: true })
```

### A report's deposit is kept only as burned SLOP for the row that names it

Nothing is sent before the deposit is finalized and judged, once it has left
the open states, or for a token outside the table. A refused deposit is
refunded whatever the row says. An accepted one is refunded when the row it
paid says `refund_due`, and kept only when that row says `kept_due`, names
this very deposit as the one that paid, and the deposit is SLOP on Robinhood
Chain kept to the burn address. The row this deposit paid gets `kept`, or
`refunded` for a refund and for a reclaim, with the event's block time; the
security area's `outcome_reason` is left as it is. A `recorded` row, or no
row, is never paid and keeps nothing.

```quint
type ReportResolveFacts = { resolveFacts: D::ResolveFacts, robinhood: bool, keptToBurn: bool }
pure def reportResolveAction(reportResolveFacts: ReportResolveFacts): D::ResolveAction =
  val base = D::resolveAction(reportResolveFacts.resolveFacts)
  if (base != D::Keep) base
  else if (reportResolveFacts.robinhood and reportResolveFacts.keptToBurn and reportResolveFacts.resolveFacts.kind == T::SlopToken) D::Keep
  else D::NoAction
pure def lawReportKeptOnlyAsBurnedSlop(reportResolveFacts: ReportResolveFacts): bool =
  reportResolveAction(reportResolveFacts) == D::Keep implies (reportResolveFacts.robinhood and reportResolveFacts.keptToBurn
    and reportResolveFacts.resolveFacts.kind == T::SlopToken and reportResolveFacts.resolveFacts.paidByThis
    and reportResolveFacts.resolveFacts.itemOutcome == D::KeptDueOutcome)
pure val reportResolveFactsValues = D::resolveFactsValues.map(f => { resolveFacts: f, robinhood: true, keptToBurn: true })
  .union(D::resolveFactsValues.map(f => { resolveFacts: f, robinhood: true, keptToBurn: false }))
```

### The security area writes and decides the row; the Worker pays it and follows the chain

The security area writes a report's row once, in the mode of that moment,
with the SLOP amount it asks, and decides `refund_due` or `kept_due` only on
a row a deposit paid, once. When the deposit is switched off, server-wide or
for the report's project, it turns each asked row that no deposit paid and
nothing decided into a `recorded` one (`releaseUnpaid` in
`backend/security/report-deposit.ts`); a deposit that names it is then an
unknown item, and a row paid in the same moment stays asked. The chain record and the Worker's scan are the
pull request deposit's own transitions; only the judgement and the action
differ.

```quint
type ReportRow = { mode: ReportMode, amountValid: bool }
type ReportChainDeposit = { made: D::ChainDeposit, robinhood: bool, keptToBurn: bool }
type ReportDeposit = { deposit: D::FeeDeposit, mode: ReportMode, amountValid: bool, robinhood: bool, keptToBurn: bool }
pure val initial: ReportDeposit = { deposit: D::initial, mode: NoReport, amountValid: false, robinhood: false, keptToBurn: false }
pure def reportFactsOf(r: ReportDeposit): ReportFacts = { kind: r.deposit.made.kind, robinhood: r.robinhood, keptToBurn: r.keptToBurn,
  rowAsked: r.mode == AskedReport, amountValid: r.amountValid, paidAtLeastDue: r.deposit.made.amountCovers,
  paidBy: D::factsOf(r.deposit).paidBy, decided: r.deposit.itemOutcome != D::Undecided }
pure def verdictOf(r: ReportDeposit): D::Refusal =
  if (r.mode == AskedReport) reportVerdict(reportFactsOf(r)) else D::depositVerdict(D::factsOf(r.deposit))
pure def actionOf(r: ReportDeposit): D::ResolveAction =
  reportResolveAction({ resolveFacts: D::resolveFactsOf(r.deposit), robinhood: r.robinhood, keptToBurn: r.keptToBurn })
pure def canWriteRow(r: ReportDeposit, reportRow: ReportRow, by: D::Party): bool = by == D::Security and r.mode == NoReport
  and reportRow.mode != NoReport
pure def writeRow(r: ReportDeposit, reportRow: ReportRow, by: D::Party): ReportDeposit =
  { ...r, mode: reportRow.mode, amountValid: reportRow.amountValid,
    deposit: { ...r.deposit, asked: reportRow.mode == AskedReport } }
pure def canReleaseRow(r: ReportDeposit, by: D::Party): bool = by == D::Security and r.mode == AskedReport
  and not(r.deposit.paid) and not(r.deposit.otherPaid) and r.deposit.itemOutcome == D::Undecided
pure def releaseRow(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, mode: RecordedReport, deposit: { ...r.deposit, asked: false } }
pure def canDecide(r: ReportDeposit, decision: D::ItemOutcome, by: D::Party): bool = by == D::Security and r.mode == AskedReport
  and r.deposit.paid and r.deposit.itemOutcome == D::Undecided and (decision == D::RefundDueOutcome or decision == D::KeptDueOutcome)
pure def decide(r: ReportDeposit, decision: D::ItemOutcome, by: D::Party): ReportDeposit =
  { ...r, deposit: { ...r.deposit, itemOutcome: decision } }
pure def canDeposit(r: ReportDeposit, reportDeposit: ReportChainDeposit, by: D::Party): bool =
  D::canDeposit(r.deposit, reportDeposit.made, by)
  and (reportDeposit.made.kind == T::SlopToken implies reportDeposit.made.keptToMatches == reportDeposit.keptToBurn)
pure def deposit(r: ReportDeposit, reportDeposit: ReportChainDeposit, by: D::Party): ReportDeposit =
  { ...r, deposit: D::deposit(r.deposit, reportDeposit.made, by), robinhood: reportDeposit.robinhood, keptToBurn: reportDeposit.keptToBurn }
pure def canConfirm(r: ReportDeposit, by: D::Party): bool = D::canConfirm(r.deposit, by)
pure def confirm(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::confirm(r.deposit, by) }
pure def canFinalize(r: ReportDeposit, by: D::Party): bool = D::canFinalize(r.deposit, by)
pure def finalize(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::finalize(r.deposit, by) }
pure def canReorganise(r: ReportDeposit, by: D::Party): bool = D::canReorganise(r.deposit, by)
pure def reorganise(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::reorganise(r.deposit, by) }
pure def canRecordConfirmed(r: ReportDeposit, by: D::Party): bool = D::canRecordConfirmed(r.deposit, by)
pure def recordConfirmed(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::recordConfirmed(r.deposit, by) }
pure def canRecordFinal(r: ReportDeposit, by: D::Party): bool = D::canRecordFinal(r.deposit, by)
pure def recordFinal(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::recordFinal(r.deposit, by) }
pure def canRemoveGone(r: ReportDeposit, by: D::Party): bool = D::canRemoveGone(r.deposit, by)
pure def removeGone(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::removeGone(r.deposit, by) }
pure def canReplaceChanged(r: ReportDeposit, reportDeposit: ReportChainDeposit, by: D::Party): bool =
  D::canReplaceChanged(r.deposit, reportDeposit.made, by) and reportDeposit.robinhood == r.robinhood
  and (reportDeposit.made.kind == T::SlopToken implies reportDeposit.made.keptToMatches == reportDeposit.keptToBurn)
pure def replaceChanged(r: ReportDeposit, reportDeposit: ReportChainDeposit, by: D::Party): ReportDeposit =
  { ...r, deposit: D::replaceChanged(r.deposit, reportDeposit.made, by), keptToBurn: reportDeposit.keptToBurn }
pure def canPayByOther(r: ReportDeposit, by: D::Party): bool = r.mode == AskedReport and D::canPayByOther(r.deposit, by)
pure def payByOther(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::payByOther(r.deposit, by) }
pure def canEndGrace(r: ReportDeposit, by: D::Party): bool = D::canEndGrace(r.deposit, by)
pure def endGrace(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::endGrace(r.deposit, by) }
pure def canJudge(r: ReportDeposit, by: D::Party): bool = by == D::Worker and r.deposit.row != D::NoRow
  and r.deposit.judgement == D::Unjudged
  and (verdictOf(r) != D::UnknownItem or (r.deposit.row == D::FinalRow and r.deposit.graceOver))
pure def judge(r: ReportDeposit, by: D::Party): ReportDeposit =
  val verdict = verdictOf(r)
  { ...r, deposit: if (verdict == D::NoRefusal) { ...r.deposit, judgement: D::Accepted, reason: D::NoRefusal, paid: true }
    else { ...r.deposit, judgement: D::Refused, reason: verdict } }
pure def canMarkDue(r: ReportDeposit, by: D::Party): bool = by == D::Worker and r.deposit.row == D::FinalRow
  and r.deposit.judgement != D::Unjudged and r.deposit.made.kind != T::NoToken and D::openState(r.deposit.state)
  and D::dueStateOf(actionOf(r)) != r.deposit.state
pure def markDue(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: { ...r.deposit, state: D::dueStateOf(actionOf(r)) } }
pure def canResolve(r: ReportDeposit, by: D::Party): bool = by == D::Chain and r.deposit.chain == D::ChainOpen and r.deposit.row == D::FinalRow
  and ((r.deposit.state == D::RefundDue and actionOf(r) == D::Refund) or (r.deposit.state == D::KeptDue and actionOf(r) == D::Keep))
pure def resolve(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::resolve(r.deposit, by) }
pure def canReclaim(r: ReportDeposit, by: D::Party): bool = D::canReclaim(r.deposit, by)
pure def reclaim(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::reclaim(r.deposit, by) }
pure def canFinalizeEvent(r: ReportDeposit, by: D::Party): bool = D::canFinalizeEvent(r.deposit, by)
pure def finalizeEvent(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::finalizeEvent(r.deposit, by) }
pure def canRecordResolution(r: ReportDeposit, by: D::Party): bool = D::canRecordResolution(r.deposit, by)
pure def recordResolution(r: ReportDeposit, by: D::Party): ReportDeposit = { ...r, deposit: D::recordResolution(r.deposit, by) }
pure def alwaysChainRulesOfADeposit(r: ReportDeposit): bool = D::alwaysRowFollowsChain(r.deposit)
  and D::alwaysOneDepositPaysOneItem(r.deposit) and D::alwaysResolvedOnceOneWay(r.deposit)
  and D::alwaysKeptOnlyWhatPaidAndWasKeptDue(r.deposit) and D::alwaysFinalStatesFollowFinalizedEvents(r.deposit)
pure def alwaysOnlyAnAskedRowIsPaid(r: ReportDeposit): bool = (r.deposit.asked iff r.mode == AskedReport)
  and (r.mode != AskedReport implies (not(r.deposit.paid) and r.deposit.judgement != D::Accepted and r.deposit.keptSent == 0
    and r.deposit.itemOutcome == D::Undecided and not(r.deposit.otherPaid)))
pure def alwaysKeptOnlyAsBurnedSlop(r: ReportDeposit): bool =
  (r.deposit.judgement == D::Accepted implies (r.mode == AskedReport and r.deposit.made.kind == T::SlopToken and r.robinhood
    and r.keptToBurn and r.amountValid))
  and (r.deposit.keptSent == 1 implies (r.deposit.made.kind == T::SlopToken and r.robinhood and r.keptToBurn))
  and (r.deposit.made.kind == T::SlopToken implies r.deposit.made.keptToMatches == r.keptToBurn)
pure def sometimesReportDepositBurned(r: ReportDeposit): bool = r.deposit.state == D::Kept and r.deposit.itemOutcome == D::KeptOutcome
pure def sometimesReportDepositRefunded(r: ReportDeposit): bool = r.mode == AskedReport and r.deposit.state == D::Refunded
  and r.deposit.itemOutcome == D::RefundedOutcome
pure def sometimesRecordedRowRefundsItsDeposit(r: ReportDeposit): bool = r.mode == RecordedReport and r.deposit.state == D::Refunded
  and r.deposit.reason == D::UnknownItem
pure def sometimesWrongNetworkRefused(r: ReportDeposit): bool = r.deposit.reason == D::ReportWrongNetwork
pure val reportRowValues = Set({ mode: AskedReport, amountValid: true }, { mode: RecordedReport, amountValid: true },
  { mode: AskedReport, amountValid: false })
pure val reportDepositValues = Set(
  { made: { kind: T::SlopToken, keptToMatches: true, amountCovers: true }, robinhood: true, keptToBurn: true },
  { made: { kind: T::SlopToken, keptToMatches: true, amountCovers: false }, robinhood: true, keptToBurn: true },
  { made: { kind: T::SlopToken, keptToMatches: true, amountCovers: true }, robinhood: false, keptToBurn: true },
  { made: { kind: T::StableToken, keptToMatches: true, amountCovers: true }, robinhood: true, keptToBurn: false },
  { made: { kind: T::NoToken, keptToMatches: false, amountCovers: false }, robinhood: true, keptToBurn: false })
pure val decisionValues = D::decisionValues
pure val byValues = D::byValues
```

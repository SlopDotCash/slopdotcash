# Refundable deposit pay pages

PRD sections 5 and 8 (operator decisions, 19 to 21 November 2026): the
contributor pay page of the refundable submission fee
(`/fee/<owner>/<repo>/<number>`) and the reporter's pay page of the private
report deposit (`/fee/report/<case>`). No sign-in: any wallet may pay, and a
refund goes to the wallet that paid. Slop signs nothing and no key enters the
page. Sources at Slop development `8660a6121`: `src/lib/submission-fee-page.ts`
(`feeRoute`, `feeRepository`, `readFeeItem`, `readFeeSettlement`,
`publishedSlopAmounts`), `src/lib/report-deposit-page.ts`
(`reportDepositCase`, `readReportDeposit`), `src/SubmissionFeePage.tsx`,
`src/ReportDepositPage.tsx`, `src/SubmissionFeePay.tsx`,
`src/lib/evm-fee-deposit.ts` and `src/lib/submission-fee-setup.ts`, with
`tests/e2e/submission-fee-pay.spec.ts` and `tests/e2e/report-deposit-pay.spec.ts`.
The published terms (networks, chain ids, deposit contracts, tokens, kept-to
addresses, limits, confirmations and the SLOP rate grace) are the
[submission fee terms](../backend/submissionFeeTerms.md); the shell compares
each field of a record with them and hands these rules the result. The
deposits themselves, their refunds and what is kept are the
[deposit records](../fees/submissionFeeDeposits.md) and
[report deposits](../fees/submissionFeeReportDeposits.md).

An address names only the pull request (an owner of 1 to 39 letters, digits
and hyphens starting with a letter or digit, a repository of 1 to 100
letters, digits, ".", "_" and "-" other than "." and "..", and a number of 1
to 10 digits without a leading zero) or the case (`sc_` followed by 8 to 72
letters, digits, "_" and "-"); anything else names nothing ("This address
does not name a pull request."). The repository's numeric GitHub id comes
from the registry built into the page, and the record's item is the hash the
page computes itself; a repository no project lists has no fee.

One instance is one browser tab on one pay page. The sender `by` is the
person in the tab (`payer`), the record reader (`reader`), the wallet
adapter (`adapter`), the chain reader (`chainReader`), the page's timer
(`timer`), the tab's visibility (`tab`), the clock (`clock`) or the page's
own bundle (`bundle`). The tab's saved request is a
[wallet attempt](./walletAttempt.md) in one slot keyed by the item. Time is
seconds.

## Story: Pay a refundable deposit for a pull request or a private report from any wallet

> As a contributor or a reporter, I want to pay the deposit Slop asks from my
> own wallet, see what happens to it, and never pay twice or into anything
> but the published contract.

### A pay page offers a way to pay only from a record that equals the published terms

A way to pay is offered only when its network and token are in the published
terms with their contract, chain id, symbol and decimals, and its kept-to
address is the fee wallet for a stablecoin and the burn address for SLOP
(`published`); its amount fits in 128 bits, and its least accepted amount
is at least one base unit and at most its amount. For a pull request a
stablecoin way asks exactly the pull request's recorded fee, as amount and
as least accepted, and a SLOP way's pair is one the published rates allow
(`publishedSlopPair`: the fee at the rate in force, its least accepted the
lower of that and the previous rate's amount during the previous rate's 48
hours, or the previous rate's amount for both). For a report the one way is
SLOP on Robinhood Chain, a whole number of SLOP, its amount and least
accepted the record's own amount. The record must be this page's (its schema,
its repository id and number or its case, its item), its recorded fee within
the published limits (a pull request), list at most 8 ways for a pull
request and at most 1 for a report, never the same network and token twice
(tokens compared lowercased), list nothing due once a deposit is recorded,
an outcome only after one, and exactly one way while a report is unpaid; a
recorded report deposit is SLOP on Robinhood Chain. A record that fails any
of this is refused whole: it offers nothing, it is never kept on screen, and
the page says "… could not be checked against Slop's published addresses. Do
not pay from this page.". While the published SLOP rate cannot be read the
SLOP ways of a pull request are withheld and the stablecoin ways stay
offered ("SLOP is not offered right now …").

```quint
import walletAttempt as WA from "./walletAttempt"
import money as M from "../settlement/money"
type Subject = PullRequestFee | ReportDeposit
type WayKind = StableWay | SlopWay
type FeeOutcome = NoOutcome | RefundDue | KeptDue | Refunded | Kept
type FeeWay = { network: str, token: str, kind: WayKind, published: bool, withinUint128: bool, amount: M::Amount,
  minimum: M::Amount, wholeSlop: bool, publishedSlopPair: bool }
type FeeRecord = { subject: Subject, ownRecord: bool, stableInLimits: bool, stableMinor: M::Amount, ways: List[FeeWay],
  paid: bool, paidPublished: bool, paidNetwork: str, paidKind: WayKind, outcome: FeeOutcome }
pure val maxPullRequestWays = 8
pure val maxReportWays = 1
pure val reportNetwork = "robinhood-mainnet"
pure def wayValid(subject: Subject, way: FeeWay, stableMinor: M::Amount, ratesRead: bool): bool =
  way.published and way.withinUint128 and M::positiveAmount(way.minimum) and M::compareAmounts(way.minimum, way.amount) <= 0
    and (if (subject == ReportDeposit)
      way.kind == SlopWay and way.network == reportNetwork and way.wholeSlop and M::equalAmounts(way.minimum, way.amount)
    else if (way.kind == StableWay) M::equalAmounts(way.amount, stableMinor) and M::equalAmounts(way.minimum, stableMinor)
    else not(ratesRead) or way.publishedSlopPair)
pure def offeredWays(record: FeeRecord, ratesRead: bool): List[FeeWay] =
  record.ways.select(w => ratesRead or w.kind == StableWay or record.subject == ReportDeposit)
pure def recordValid(record: FeeRecord, ratesRead: bool): bool =
  val due = offeredWays(record, ratesRead)
  record.ownRecord and (record.subject == ReportDeposit or record.stableInLimits)
    and record.ways.length() <= (if (record.subject == ReportDeposit) maxReportWays else maxPullRequestWays)
    and record.ways.every(w => wayValid(record.subject, w, record.stableMinor, ratesRead)
      and record.ways.select(o => o.network == w.network and o.token == w.token).length() == 1)
    and (record.paid implies (due.length() == 0 and record.paidPublished))
    and (record.outcome != NoOutcome implies record.paid)
    and (record.subject == ReportDeposit implies
      (if (record.paid) record.paidNetwork == reportNetwork and record.paidKind == SlopWay else due.length() == 1))
pure def waysShown(record: FeeRecord, ratesRead: bool): int =
  if (recordValid(record, ratesRead)) offeredWays(record, ratesRead).length() else 0
pure def lawInvalidRecordOffersNothing(record: FeeRecord, ratesRead: bool): bool =
  not(recordValid(record, ratesRead)) implies waysShown(record, ratesRead) == 0
pure def lawRecordedOffersNothing(record: FeeRecord, ratesRead: bool): bool =
  record.paid implies waysShown(record, ratesRead) == 0
pure def lawReportPaysOnlyBurnedSlop(record: FeeRecord, ratesRead: bool): bool =
  (record.subject == ReportDeposit and recordValid(record, ratesRead))
    implies record.ways.every(w => w.kind == SlopWay and w.network == reportNetwork and w.wholeSlop)
pure def lawUnreadRateWithholdsOnlySlop(record: FeeRecord): bool =
  (record.subject == PullRequestFee and recordValid(record, false))
    implies offeredWays(record, false).every(w => w.kind == StableWay)
pure val stableWay: FeeWay = { network: "base-mainnet", token: "usdc", kind: StableWay, published: true, withinUint128: true,
  amount: List(2), minimum: List(2), wholeSlop: false, publishedSlopPair: false }
pure val slopWay: FeeWay = { network: reportNetwork, token: "slop", kind: SlopWay, published: true, withinUint128: true,
  amount: List(5), minimum: List(4), wholeSlop: true, publishedSlopPair: true }
pure val dueFee: FeeRecord = { subject: PullRequestFee, ownRecord: true, stableInLimits: true, stableMinor: List(2),
  ways: List(stableWay, slopWay), paid: false, paidPublished: false, paidNetwork: "", paidKind: StableWay, outcome: NoOutcome }
pure val dueReport: FeeRecord = { ...dueFee, subject: ReportDeposit, ways: List({ ...slopWay, minimum: List(5) }) }
pure val paidFee: FeeRecord = { ...dueFee, ways: List(), paid: true, paidPublished: true, paidNetwork: "base-mainnet",
  outcome: RefundDue }
pure val recordValues = Set(dueFee, dueReport, paidFee, { ...dueFee, ownRecord: false },
  { ...dueFee, ways: List(stableWay, { ...slopWay, publishedSlopPair: false }) }, { ...dueFee, ways: List(stableWay, stableWay) },
  { ...dueFee, paid: true, paidPublished: true }, { ...dueReport, ways: List({ ...slopWay, wholeSlop: false }) },
  { ...dueFee, ways: List() })
```

### Nothing is offered while the deposit is switched off, and a recorded deposit is still shown

Whether the submission fee and the report deposit are switched on is fixed
in the page's bundle (`SUBMISSION_FEE_SWITCHED_ON`,
`REPORT_DEPOSIT_SWITCHED_ON`). An address that names nothing, a repository no
project lists, a record still loading, a failed read, a record Slop never
asked ("Slop has not asked a submission fee for this pull request. No fee is
due."), a switched-off unpaid record and a recorded deposit are distinct. A
switched-off page says so and offers no way to pay. A recorded deposit is
shown, final or not ("Its block is not final yet …"), with its outcome
(refund due, kept due, refunded, kept) and its settling transaction, also
while the deposit is switched off. A read that fails in transit keeps the
record on screen and says the last one read is shown; a refused record never
stays.

```quint
type PayPage = NotAddressed | NotRegistered | Loading | Failed | NothingAsked | SwitchedOff | Due | Recorded
type FreshRead = NotConfirmed | SameDue | ChangedDue
type Phase = Idle | Reviewed | Awaiting | Sent | Unclear
type Origin = NoCheck | AutoCheck | PayerCheck
type ChainResult = StillPending | ReceivedRead | FinalRead | FinalMismatch | ApprovalRead | Reverted | NotSent
type Evidence = NoEvidence | Received | Finished
type Notice = Quiet | StorageBlocked | DueChanged | DeclinedNotice | WrongWallet | CheckFailed | TxFailed | ApprovalConfirmed
  | ReceivedNotice | VerifiedNotice | LocalCleared
type PayFlow = { opened: bool, subject: Subject, switchedOn: bool, page: PayPage, dueWays: int, phase: Phase,
  freshRead: FreshRead, slot: WA::Attempt, walletHash: bool, connected: bool, checking: Origin, autoAsks: int,
  evidence: Evidence, depositedAt: int, watching: bool, hidden: bool, now: int, notice: Notice, used: List[str] }
pure val payer = 1
pure val reader = 0
pure val adapter = -1
pure val chainReader = -2
pure val timer = -3
pure val tab = -4
pure val clock = -5
pure val bundle = -6
pure val initial: PayFlow = { opened: false, subject: PullRequestFee, switchedOn: false, page: Loading, dueWays: 0, phase: Idle,
  freshRead: NotConfirmed, slot: WA::noAttempt, walletHash: false, connected: false, checking: NoCheck, autoAsks: 0,
  evidence: NoEvidence, depositedAt: 0, watching: false, hidden: false, now: 1, notice: Quiet, used: List() }
pure def pageAfterRecord(record: FeeRecord, ratesRead: bool, switchedOn: bool): PayPage =
  if (not(recordValid(record, ratesRead))) Failed else if (record.paid) Recorded
  else if (not(switchedOn)) SwitchedOff else Due
pure def recordShown(page: PayPage): bool = page == NothingAsked or page == SwitchedOff or page == Due or page == Recorded
pure def canOpenPage(p: PayFlow, subject: Subject, addressed: bool, registered: bool, switchedOn: bool, by: int): bool =
  by == bundle and not(p.opened)
pure def openPage(p: PayFlow, subject: Subject, addressed: bool, registered: bool, switchedOn: bool, by: int): PayFlow =
  { ...p, opened: true, subject: subject, switchedOn: switchedOn, dueWays: 0,
    page: if (not(addressed)) NotAddressed else if (not(registered)) NotRegistered else Loading }
pure def canObserveRecord(p: PayFlow, record: FeeRecord, ratesRead: bool, by: int): bool =
  by == reader and p.opened and p.page != NotAddressed and p.page != NotRegistered and record.subject == p.subject
pure def observeRecord(p: PayFlow, record: FeeRecord, ratesRead: bool, by: int): PayFlow =
  val page = pageAfterRecord(record, ratesRead, p.switchedOn)
  { ...p, page: page, dueWays: if (page == Due) waysShown(record, ratesRead) else 0,
    watching: p.watching and page != Recorded }
pure def canObserveNoRecord(p: PayFlow, by: int): bool =
  by == reader and p.opened and p.page != NotAddressed and p.page != NotRegistered
pure def observeNoRecord(p: PayFlow, by: int): PayFlow = { ...p, page: NothingAsked, dueWays: 0 }
pure def canReadFails(p: PayFlow, by: int): bool = by == reader and p.opened and p.page != NotAddressed and p.page != NotRegistered
pure def readFails(p: PayFlow, by: int): PayFlow = if (recordShown(p.page)) p else { ...p, page: Failed, dueWays: 0 }
pure def lawSwitchedOffOffersNothing(record: FeeRecord, ratesRead: bool): bool =
  pageAfterRecord(record, ratesRead, false) != Due
pure def lawRecordedShownWhileSwitchedOff(record: FeeRecord, ratesRead: bool): bool =
  (recordValid(record, ratesRead) and record.paid) implies pageAfterRecord(record, ratesRead, false) == Recorded
pure def lawRefusedRecordIsNeverShown(record: FeeRecord, ratesRead: bool, switchedOn: bool): bool =
  not(recordValid(record, ratesRead)) implies pageAfterRecord(record, ratesRead, switchedOn) == Failed
```

### The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item

The payer connects a wallet; while the tab holds a saved request, only the
wallet that sent it may reconnect ("Reconnect the wallet that submitted this
payment: <address>"). The payer reviews one way against the wallet. Sending
first reads the record again: when the way is no longer due as shown, or the
pull request is already recorded as paid, nothing is sent and the page reads
the record again ("The fee due for this pull request changed. Nothing was
sent. Review the payment again."). Otherwise the slot is created before the
wallet is asked; an occupied slot or a storage failure asks nothing. A
returned hash or batch reference is saved; a declined request clears its own
attempt ("You declined the wallet request. Nothing was sent."); an unclear
one keeps it until the payer enters the transaction hash from wallet
activity, or, after checking wallet activity, says nothing was sent: an
unclear request with no hash, batch reference or entered transaction hash is
then cleared, exactly that attempt, and the payment must be reviewed again
("Local request cleared. Review again before sending."); a request with a
hash is never cleared this way. While the tab holds no saved request and no
deposit of the tab waits for its record, the payer may choose another wallet
("Choose another wallet"), which drops the review and asks for a wallet
again (development `src/SubmissionFeePay.tsx` at `7f71c6ce9`, the
`PendingWalletCheck` `unsent` recovery and the wallet chooser). A finished
deposit from this tab blocks another payment for an hour while the record
still lists a way to pay ("A deposit from this browser tab is already on
chain …"); after the hour the page says it did not count and is sent back to
the wallet that paid it.

```quint
pure val recordWaitSeconds = 3600
pure def depositedWithinHour(p: PayFlow): bool = p.depositedAt > 0 and p.now - p.depositedAt < recordWaitSeconds
pure def canConnectWallet(p: PayFlow, payingWallet: bool, by: int): bool = by == adapter and p.opened
pure def connectWallet(p: PayFlow, payingWallet: bool, by: int): PayFlow =
  if (p.slot != WA::noAttempt and not(payingWallet)) { ...p, connected: false, notice: WrongWallet }
  else { ...p, connected: true, notice: Quiet }
pure def canReview(p: PayFlow, by: int): bool = by == payer and p.page == Due and p.dueWays > 0 and p.connected
  and (p.phase == Idle or p.phase == Reviewed)
pure def review(p: PayFlow, by: int): PayFlow = { ...p, phase: Reviewed, freshRead: NotConfirmed, notice: Quiet }
pure def canConfirmDue(p: PayFlow, fresh: FreshRead, by: int): bool =
  by == reader and p.phase == Reviewed and p.freshRead == NotConfirmed and fresh != NotConfirmed
pure def confirmDue(p: PayFlow, fresh: FreshRead, by: int): PayFlow =
  if (fresh == SameDue) { ...p, freshRead: SameDue }
  else { ...p, phase: Idle, freshRead: NotConfirmed, watching: true, notice: DueChanged }
pure def canSend(p: PayFlow, identity: str, stored: bool, by: int): bool =
  by == payer and p.page == Due and p.phase == Reviewed and p.freshRead == SameDue and p.slot == WA::noAttempt
    and not(depositedWithinHour(p)) and p.connected and identity != "" and not(p.used.includes(identity))
pure def send(p: PayFlow, identity: str, stored: bool, by: int): PayFlow =
  if (not(stored)) { ...p, freshRead: NotConfirmed, notice: StorageBlocked }
  else { ...p, phase: Awaiting, freshRead: NotConfirmed, evidence: NoEvidence, walletHash: false, autoAsks: 0,
    slot: { ...WA::noAttempt, identity: identity, bytesId: "deposit" }, used: p.used.append(identity), notice: Quiet }
pure def canWalletReply(p: PayFlow, identity: str, reply: WA::Reply, hash: str, by: int): bool =
  by == adapter and p.phase == Awaiting and identity != "" and p.slot.identity == identity and reply != WA::NoReply
    and ((reply == WA::Signed) iff (hash != ""))
pure def walletReply(p: PayFlow, identity: str, reply: WA::Reply, hash: str, by: int): PayFlow =
  val expected = { ...WA::noAttempt, identity: identity, bytesId: "deposit" }
  if (reply == WA::Signed) { ...p, phase: Sent, walletHash: true, autoAsks: 0,
    slot: WA::compareAndSet(p.slot, expected, { ...p.slot, hash: hash }) }
  else if (reply == WA::Declined) { ...p, phase: Reviewed, slot: WA::compareAndClear(p.slot, expected), notice: DeclinedNotice }
  else { ...p, phase: Unclear }
pure def canEnterHash(p: PayFlow, candidate: str, by: int): bool =
  by == payer and candidate != "" and p.phase == Unclear and p.checking == NoCheck
pure def enterHash(p: PayFlow, candidate: str, by: int): PayFlow =
  { ...p, phase: Sent, walletHash: false, slot: WA::compareAndReplace(p.slot, p.slot, { ...p.slot, candidate: candidate }) }
pure def canConfirmUnsent(p: PayFlow, by: int): bool = by == payer and p.phase == Unclear and p.checking == NoCheck
  and p.slot.hash == "" and p.slot.candidate == ""
pure def confirmUnsent(p: PayFlow, by: int): PayFlow =
  { ...p, phase: Idle, freshRead: NotConfirmed, walletHash: false, slot: WA::compareAndClear(p.slot, p.slot), notice: LocalCleared }
pure def canDisconnectWallet(p: PayFlow, by: int): bool = by == payer and p.connected and p.page == Due and p.dueWays > 0
  and p.slot == WA::noAttempt and not(depositedWithinHour(p))
pure def disconnectWallet(p: PayFlow, by: int): PayFlow = { ...p, connected: false, phase: Idle, freshRead: NotConfirmed }
pure def canObserveClock(p: PayFlow, now: int, by: int): bool = by == clock and now > p.now
pure def observeClock(p: PayFlow, now: int, by: int): PayFlow = { ...p, now: now }
pure def stepWalletAskedOnlyAfterSameDue(before: PayFlow, via: str, after: PayFlow): bool =
  (via == "send" and after.phase == Awaiting) implies
    (before.page == Due and before.freshRead == SameDue and before.slot == WA::noAttempt and not(depositedWithinHour(before)))
pure def stepNoSecondPaymentWithinHour(before: PayFlow, after: PayFlow): bool =
  (before.phase != Awaiting and after.phase == Awaiting) implies not(depositedWithinHour(before))
```

### A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour

The chain reader checks the saved request against the reviewed way. A
transaction must come from the connected wallet, to the reviewed contract or
token, with the reviewed call and no native value. An approval or allowance
reset settles at canonical inclusion, as in the
[batched deposit](./batchedDeposit.md) (`approvalSettled`), moves no funds
and opens the deposit's review. A deposit is Received once the contract's
one `Deposited` event is in a canonical block ("Deposit received in a
<network> block. … A refund or a kept fee is sent only after <network>
finalizes the block. You can leave this page."): the request stays saved and
checked, and a later read that no longer sees it withdraws the notice. It is
Finished only when that block is final and the event's token, amount and
kept-to address equal the reviewed way; a final event that differs is
refused and keeps the request. A wallet's batch status only names the
transaction and never proves a deposit. A reverted or unsent request clears
the slot and moves nothing. Received and Finished each read the record again.

Automatic checks ask only for a hash the wallet returned or its batch
reference, at most 240 times per hash, the first 20 three seconds apart and
then fifteen, none while the tab is hidden (a hidden tab spends no ask), as
for the owner's vault transfers ([owner vault](./ownerVault.md)); the
payer's button checks any saved hash. While a deposit of this tab waits for
its record and the tab is shown, the record is read again every 20 seconds
until it shows the deposit.

```quint
pure val autoAskLimit = 240
pure val autoFastAsks = 20
pure val autoFastSeconds = 3
pure val autoSlowSeconds = 15
pure val recordRefreshSeconds = 20
pure def autoAskDelay(autoAsks: int): int = if (autoAsks < autoFastAsks) autoFastSeconds else autoSlowSeconds
pure def recordRefreshDue(p: PayFlow): bool = p.watching and not(p.hidden) and p.page != Recorded
pure def canAsk(p: PayFlow, origin: Origin, by: int): bool =
  p.phase == Sent and p.connected and p.switchedOn and p.checking == NoCheck and
  (if (origin == AutoCheck) by == timer and p.walletHash and p.slot.hash != "" and not(p.hidden) and p.autoAsks < autoAskLimit
   else origin == PayerCheck and by == payer)
pure def ask(p: PayFlow, origin: Origin, by: int): PayFlow =
  { ...p, checking: origin, autoAsks: p.autoAsks + (if (origin == AutoCheck) 1 else 0) }
pure def canAnswer(p: PayFlow, result: ChainResult, by: int): bool = by == chainReader and p.checking != NoCheck and p.phase == Sent
pure def answer(p: PayFlow, result: ChainResult, by: int): PayFlow =
  val answered = { ...p, checking: NoCheck }
  val cleared = { ...answered, slot: WA::compareAndClear(p.slot, p.slot), walletHash: false, evidence: NoEvidence }
  if (result == FinalRead) { ...cleared, phase: Idle, evidence: Finished, depositedAt: p.now, watching: true,
    notice: VerifiedNotice }
  else if (result == ReceivedRead) { ...answered, evidence: Received, watching: true, notice: ReceivedNotice }
  else if (result == ApprovalRead) { ...cleared, phase: if (p.page == Due) Reviewed else Idle, freshRead: NotConfirmed,
    notice: ApprovalConfirmed }
  else if (result == Reverted or result == NotSent) { ...cleared, phase: Idle, notice: TxFailed }
  else if (result == FinalMismatch) { ...answered, notice: CheckFailed }
  else { ...answered, evidence: NoEvidence, notice: if (p.evidence == Received) Quiet else p.notice }
pure def canSetTabHidden(p: PayFlow, hidden: bool, by: int): bool = by == tab and hidden != p.hidden
pure def setTabHidden(p: PayFlow, hidden: bool, by: int): PayFlow = { ...p, hidden: hidden }
```

### Rules

The saved request outlives every check that has not settled it; Received
never clears it and Finished always does. Only the Due page offers a way to
pay. Automatic asks stay within their budget and a hidden tab spends none.
The clock has started, so a finished deposit's time is after it.

```quint
pure def alwaysAttemptSaved(p: PayFlow): bool =
  ((p.phase == Awaiting or p.phase == Sent or p.phase == Unclear) implies p.slot != WA::noAttempt)
  and (p.phase == Awaiting implies (p.slot.identity != "" and p.slot.hash == "" and p.slot.candidate == ""
    and p.slot.bytesId == "deposit"))
  and (p.phase == Sent implies (p.slot.hash != "" or p.slot.candidate != ""))
  and (p.walletHash implies p.slot.hash != "")
pure def alwaysOnlyDueOffersWays(p: PayFlow): bool = p.dueWays > 0 implies p.page == Due
pure def alwaysReceivedKeepsTheAttempt(p: PayFlow): bool = p.evidence == Received implies (p.slot != WA::noAttempt and p.phase == Sent)
pure def alwaysFinishedHasNoAttempt(p: PayFlow): bool = p.evidence == Finished implies (p.slot == WA::noAttempt and p.depositedAt > 0)
pure def alwaysAutoAsksWithinLimit(p: PayFlow): bool = p.autoAsks >= 0 and p.autoAsks <= autoAskLimit
pure def alwaysClockStarted(p: PayFlow): bool = p.now > 0 and p.depositedAt >= 0
pure def alwaysAttemptsFresh(p: PayFlow): bool = p.slot.identity == "" or p.used.includes(p.slot.identity)
pure def stepHiddenTabSpendsNothing(before: PayFlow, after: PayFlow): bool =
  before.hidden implies after.autoAsks <= before.autoAsks
pure def stepFinishedOnlyFromAFinalRead(before: PayFlow, via: str, after: PayFlow): bool =
  (before.evidence != Finished and after.evidence == Finished) implies via == "answer"
pure def sometimesDueOffered(p: PayFlow): bool = p.page == Due and p.dueWays > 0
pure def sometimesSwitchedOff(p: PayFlow): bool = p.page == SwitchedOff
pure def sometimesRecordedWhileSwitchedOff(p: PayFlow): bool = p.page == Recorded and not(p.switchedOn)
pure def sometimesRefusedRecord(p: PayFlow): bool = p.page == Failed and p.dueWays == 0
pure def sometimesNotAddressed(p: PayFlow): bool = p.page == NotAddressed
pure def sometimesDueChanged(p: PayFlow): bool = p.notice == DueChanged and p.slot == WA::noAttempt
pure def sometimesReceived(p: PayFlow): bool = p.evidence == Received and p.slot != WA::noAttempt
pure def sometimesFinished(p: PayFlow): bool = p.evidence == Finished and p.watching
pure def sometimesBlockedWithinHour(p: PayFlow): bool = p.page == Due and p.dueWays > 0 and depositedWithinHour(p)
pure def sometimesUnclearKept(p: PayFlow): bool = p.phase == Unclear and p.slot != WA::noAttempt
pure def sometimesWrongWalletRefused(p: PayFlow): bool = p.notice == WrongWallet and p.slot != WA::noAttempt
pure def sometimesAutoChecked(p: PayFlow): bool = p.autoAsks > 0 and p.checking == AutoCheck
pure def sometimesUnsentCleared(p: PayFlow): bool = p.notice == LocalCleared and p.slot == WA::noAttempt and p.phase == Idle
pure def sometimesAnotherWalletAfterDecline(p: PayFlow): bool = p.notice == DeclinedNotice and not(p.connected)
  and p.page == Due and p.phase == Idle
pure val byValues = Set(payer, reader, adapter, chainReader, timer, tab, clock, bundle)
pure val identityValues = Set("d1", "d2")
pure val hashValues = Set("", "h1")
pure val candidateValues = Set("h2")
pure val nowValues = Set(10, 3700)
pure val weight_observeRecord = 6
pure val weight_review = 6
pure val weight_confirmDue = 6
pure val weight_send = 8
pure val weight_walletReply = 8
pure val weight_ask = 8
pure val weight_answer = 10
pure val eval_witness_sometimesReceived = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Signed, "h1", adapter),
  ("ask", AutoCheck, timer),
  ("answer", ReceivedRead, chainReader))
pure val eval_witness_sometimesFinished = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Uncertain, "", adapter),
  ("enterHash", "h2", payer),
  ("ask", PayerCheck, payer),
  ("answer", FinalRead, chainReader))
pure val eval_witness_sometimesBlockedWithinHour = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Signed, "h1", adapter),
  ("ask", AutoCheck, timer),
  ("answer", FinalRead, chainReader))
pure val eval_witness_sometimesUnclearKept = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Uncertain, "", adapter))
pure val eval_witness_sometimesWrongWalletRefused = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("connectWallet", false, adapter))
pure val eval_witness_sometimesAutoChecked = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Signed, "h1", adapter),
  ("ask", AutoCheck, timer))
pure val eval_witness_sometimesUnsentCleared = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Uncertain, "", adapter),
  ("confirmUnsent", payer))
pure val eval_witness_sometimesAnotherWalletAfterDecline = (
  ("openPage", PullRequestFee, true, true, true, bundle),
  ("observeRecord", dueFee, true, reader),
  ("connectWallet", true, adapter),
  ("review", payer),
  ("confirmDue", SameDue, reader),
  ("send", "d1", true, payer),
  ("walletReply", "d1", WA::Declined, "", adapter),
  ("disconnectWallet", payer))
```

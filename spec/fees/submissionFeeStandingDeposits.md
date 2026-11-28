# Standing submission fee deposits

PRD section 5, "Standing deposit", and section 6, FEE-08 (operator decision,
23 November 2026; deployed on Robinhood Chain on 24 November 2026 at
`0x446604d5c3Cc99c60CCE3d5C4357BC60f5b45993`, start block 122128533): a
contributor with a prior merged pull request on a project may post one
refundable SLOP standing deposit on the `robinhood-standing` ledger instead of
paying per pull request. Sources at Slop `main-old`:
`src/lib/standing-deposit.mjs`, `workers/submission-fee/standing.ts`,
`workers/slopbot/standing-deposit.ts`, migrations `0149_standing_deposits.sql`
and `0150_standing_deposit_merged_authors.sql`, and
`formal/models/fees/standing_deposit.qnt` (#3312).

The website writes the contributor's row (`standing_deposits`), cancels an
unpaid row, or records a withdrawal request on a paid row; the submission-fee
Worker reads the standing contract as the `robinhood-standing` ledger, judges
each deposit, marks the row paid, and sends what the row says is due; Slopbot
covers open pull requests up to the cap, checks each covered pull request for
the maintainer keep-fee label within its 21-day window and 48-hour grace
period, and decides the outcome once.

## Story: Take and settle standing deposits only as burned SLOP on the standing ledger

> As a contributor, I want my standing deposit to pay my row only when it is
> the asked SLOP amount on the standing ledger kept to the burn address, and to
> be kept only when a covered pull request incurs a confirmed strike.

### A standing deposit pays its row only as burned SLOP on the standing ledger

A standing deposit is judged on `robinhood-standing` in this order: the token
must be in the Robinhood Chain table (`token_not_accepted`), the ledger must be
`robinhood-standing` (`standing_wrong_ledger`), the token must be SLOP
(`standing_token_not_slop`), the kept destination must be the burn address
(`wrong_kept_to`), the row must exist (`unknown_item`), the row must not be
cancelled (`standing_cancelled`), its SLOP amount must be positive
(`standing_amount_invalid`), the deposit must cover that amount
(`amount_below_due`), no other deposit may have paid the row
(`item_already_paid`), and the row must not already be decided unless this
deposit paid it (`item_already_decided`). Nothing is sent until the deposit is
finalized and judged. A refused deposit of an accepted token is refunded; an
accepted one is refunded on `refund_due` and kept only on `kept_due` as burned
SLOP on `robinhood-standing` for the row that names it.

```quint
import submissionFeeDeposits as D from "./submissionFeeDeposits"
import submissionFeeTerms as T from "../backend/submissionFeeTerms"
type StandingRefusal = StandingNoRefusal | StandingTokenNotAccepted | StandingWrongLedger | StandingTokenNotSlop
  | StandingWrongKeptTo | StandingUnknownItem | StandingCancelled | StandingAmountInvalid
  | StandingAmountBelowDue | StandingAlreadyPaid | StandingAlreadyDecided
type StandingDepositFacts = { kind: T::TokenKind, standingLedger: bool, keptToBurn: bool, rowKnown: bool,
  cancelled: bool, amountValid: bool, paidAtLeastDue: bool, paidBy: D::PaidBy, decided: bool }
type StandingResolveFacts = { resolveFacts: D::ResolveFacts, standingLedger: bool, keptToBurn: bool }
pure val standingDepositNetwork = "robinhood-mainnet"
pure val standingDepositLedger = "robinhood-standing"
pure val standingDepositContract = "0x446604d5c3Cc99c60CCE3d5C4357BC60f5b45993"
pure val standingDepositStartBlock = 122128533
pure val standingDepositUsdMinor = 10000000
pure val standingDepositCap = 10
pure val standingDepositReclaimDays = 365
pure val standingDepositExpiryDays = 340
pure val standingDepositWindowDays = 21
pure val standingDepositGraceHours = 48
pure def standingDepositVerdict(depositFacts: StandingDepositFacts): StandingRefusal =
  if (depositFacts.kind == T::NoToken) StandingTokenNotAccepted
  else if (not(depositFacts.standingLedger)) StandingWrongLedger
  else if (depositFacts.kind != T::SlopToken) StandingTokenNotSlop
  else if (not(depositFacts.keptToBurn)) StandingWrongKeptTo
  else if (not(depositFacts.rowKnown)) StandingUnknownItem
  else if (depositFacts.cancelled) StandingCancelled
  else if (not(depositFacts.amountValid)) StandingAmountInvalid
  else if (not(depositFacts.paidAtLeastDue)) StandingAmountBelowDue
  else if (depositFacts.paidBy == D::OtherDeposit) StandingAlreadyPaid
  else if (depositFacts.paidBy != D::ThisDeposit and depositFacts.decided) StandingAlreadyDecided
  else StandingNoRefusal
pure def standingResolveAction(standingResolveFacts: StandingResolveFacts): D::ResolveAction =
  val base = D::resolveAction(standingResolveFacts.resolveFacts)
  if (base != D::Keep) base
  else if (standingResolveFacts.standingLedger and standingResolveFacts.keptToBurn and standingResolveFacts.resolveFacts.kind == T::SlopToken) D::Keep
  else D::NoAction
pure def lawStandingPaidOnlyByBurnedSlop(depositFacts: StandingDepositFacts): bool =
  standingDepositVerdict(depositFacts) == StandingNoRefusal implies
    (depositFacts.kind == T::SlopToken and depositFacts.standingLedger and depositFacts.keptToBurn and depositFacts.rowKnown
      and not(depositFacts.cancelled) and depositFacts.amountValid and depositFacts.paidAtLeastDue
      and depositFacts.paidBy != D::OtherDeposit)
pure def lawStandingKeptOnlyAsBurnedSlop(standingResolveFacts: StandingResolveFacts): bool =
  standingResolveAction(standingResolveFacts) == D::Keep implies
    (standingResolveFacts.standingLedger and standingResolveFacts.keptToBurn and standingResolveFacts.resolveFacts.kind == T::SlopToken
      and standingResolveFacts.resolveFacts.paidByThis and standingResolveFacts.resolveFacts.itemOutcome == D::KeptDueOutcome)
pure val depositFactsValues = Set(
  { kind: T::SlopToken, standingLedger: true, keptToBurn: true, rowKnown: true, cancelled: false, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::StableToken, standingLedger: true, keptToBurn: false, rowKnown: true, cancelled: false, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, standingLedger: false, keptToBurn: true, rowKnown: true, cancelled: false, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, standingLedger: true, keptToBurn: true, rowKnown: true, cancelled: true, amountValid: true, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, standingLedger: true, keptToBurn: true, rowKnown: true, cancelled: false, amountValid: false, paidAtLeastDue: true, paidBy: D::Unpaid, decided: false },
  { kind: T::SlopToken, standingLedger: true, keptToBurn: true, rowKnown: true, cancelled: false, amountValid: true, paidAtLeastDue: true, paidBy: D::OtherDeposit, decided: true },
  { kind: T::SlopToken, standingLedger: true, keptToBurn: true, rowKnown: true, cancelled: false, amountValid: true, paidAtLeastDue: true, paidBy: D::ThisDeposit, decided: true })
pure val standingResolveFactsValues = D::resolveFactsValues.map(f => { resolveFacts: f, standingLedger: true, keptToBurn: true })
  .union(D::resolveFactsValues.map(f => { resolveFacts: f, standingLedger: true, keptToBurn: false }))
```

### Coverage respects the cap, prior merge, withdrawal wait, and irreversible strikes

Two pull request slots model the open-cover cap at one so the cap-exceeded
case is reachable in two pull requests. A paid standing deposit covers an open
pull request only while its outcome is undecided, coverage has not ended by
withdrawal or 340-day expiry, the project accepts standing deposits, the author
has a prior merged pull request on the project, and fewer than the cap of
covered pull requests are open. An unpaid per-pull-request ask is cleared when
the standing deposit covers it. Closing a covered pull request within its
21-day window with the maintainer keep-fee label starts a 48-hour grace period
(`PendingStrike`); removing the label or reopening during grace returns it to
`Watch`, while remaining closed and labelled through grace records an
irreversible `Strike`. The label counts only when it was added at or before
the end of that window: a label first seen after the window is dated from the
pull request's label events, one added later is no label, and an unreadable
addition time decides nothing and is read again a day later. Once any covered pull request strikes, the deposit can
only be kept (`KeptDue` then `Kept`). It is refunded (`RefundDue` then
`Refunded`) only after coverage ended by withdrawal or expiry, the 21-day wait
passed with every covered pull request past its window, and every covered pull
request is `Clear`. At most one outcome is ever sent, never both.

```quint
type StandingRowState = NoRow | UnpaidRow | CancelledRow | PaidRow
type StandingOutcome = NoOutcome | RefundDue | KeptDue | Refunded | Kept
type CoverKind = Uncovered | Watch | PendingStrike | Clear | Strike
type Slot = FirstSlot | SecondSlot
type CoverSlot = { open: bool, covered: bool, closed: bool, merged: bool, labelled: bool,
  closedInWindow: bool, seen: bool, windowOver: bool, graceOver: bool, cover: CoverKind, asked: bool }
type StandingState = { row: StandingRowState, withdrawn: bool, expired: bool, waitOver: bool,
  accepted: bool, mergedBefore: bool, outcome: StandingOutcome, pr0: CoverSlot, pr1: CoverSlot,
  keptSent: int, refundSent: int }
pure val emptySlot: CoverSlot = { open: false, covered: false, closed: false, merged: false, labelled: false,
  closedInWindow: false, seen: false, windowOver: false, graceOver: false, cover: Uncovered, asked: false }
pure val initial: StandingState = { row: NoRow, withdrawn: false, expired: false, waitOver: false,
  accepted: true, mergedBefore: false, outcome: NoOutcome, pr0: emptySlot, pr1: emptySlot,
  keptSent: 0, refundSent: 0 }
pure def slotOf(s: StandingState, slot: Slot): CoverSlot = if (slot == FirstSlot) s.pr0 else s.pr1
pure def withSlot(slot: Slot, nextSlot: CoverSlot, s: StandingState): StandingState =
  if (slot == FirstSlot) { ...s, pr0: nextSlot } else { ...s, pr1: nextSlot }
pure def openCoveredCount(s: StandingState): int =
  (if (s.pr0.covered and s.pr0.open) 1 else 0) + (if (s.pr1.covered and s.pr1.open) 1 else 0)
pure def coverEnded(s: StandingState): bool = s.withdrawn or s.expired
pure def coveringNow(s: StandingState): bool = s.row == PaidRow and s.outcome == NoOutcome and not(coverEnded(s))
pure def mayCover(s: StandingState): bool = coveringNow(s) and s.accepted and s.mergedBefore and openCoveredCount(s) < 1
pure def strikeHappened(s: StandingState): bool = s.pr0.cover == Strike or s.pr1.cover == Strike
pure def allCoveredClear(s: StandingState): bool =
  (s.pr0.covered implies s.pr0.cover == Clear) and (s.pr1.covered implies s.pr1.cover == Clear)
pure def coverStateOf(p: CoverSlot): CoverKind =
  if (p.merged) Clear
  else if (p.closed and p.closedInWindow and p.labelled) (if (p.seen and p.graceOver) Strike else PendingStrike)
  else if (p.windowOver) Clear
  else Watch
pure def checkedSlot(p: CoverSlot): CoverSlot =
  val nextSeen = p.seen or (p.closed and p.closedInWindow and p.labelled)
  val updated = { ...p, seen: nextSeen }
  { ...updated, cover: coverStateOf(updated) }
pure def dueOutcomeOf(s: StandingState): StandingOutcome =
  if (s.row != PaidRow or s.outcome != NoOutcome) NoOutcome
  else if (strikeHappened(s)) KeptDue
  else if (coverEnded(s) and s.waitOver and allCoveredClear(s)) RefundDue
  else NoOutcome
pure def canPostRow(s: StandingState): bool = s.row == NoRow
pure def postRow(s: StandingState): StandingState = { ...s, row: UnpaidRow }
pure def canCancelRow(s: StandingState): bool = s.row == UnpaidRow
pure def cancelRow(s: StandingState): StandingState = { ...s, row: CancelledRow }
pure def canPayRow(s: StandingState): bool = s.row == UnpaidRow
pure def payRow(s: StandingState): StandingState = { ...s, row: PaidRow }
pure def canRequestWithdraw(s: StandingState): bool = s.row == PaidRow and s.outcome == NoOutcome and not(s.withdrawn)
pure def requestWithdraw(s: StandingState): StandingState = { ...s, withdrawn: true }
pure def canExpireDeposit(s: StandingState): bool = s.row == PaidRow and not(s.expired)
pure def expireDeposit(s: StandingState): StandingState = { ...s, expired: true }
pure def canPassWait(s: StandingState): bool = coverEnded(s) and not(s.waitOver)
  and (s.pr0.covered implies s.pr0.windowOver) and (s.pr1.covered implies s.pr1.windowOver)
pure def passWait(s: StandingState): StandingState = { ...s, waitOver: true }
pure def canOwnerRefuseStanding(s: StandingState): bool = s.accepted
pure def ownerRefuseStanding(s: StandingState): StandingState = { ...s, accepted: false }
pure def canRecordFirstMerge(s: StandingState): bool = not(s.mergedBefore)
pure def recordFirstMerge(s: StandingState): StandingState = { ...s, mergedBefore: true }
pure def canOpenSlot(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.cover == Uncovered and not(p.asked) and not(p.covered) and not(p.closed) and not(p.open)
pure def openSlot(s: StandingState, slot: Slot): StandingState =
  withSlot(slot, { ...emptySlot, open: true }, s)
pure def canCoverSlot(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.open and not(p.covered) and mayCover(s)
pure def coverSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, covered: true, asked: false, cover: Watch }, s)
pure def canAskSlot(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.open and not(p.covered) and not(p.asked) and not(mayCover(s))
pure def askSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, asked: true }, s)
pure def canMergeSlot(s: StandingState, slot: Slot): bool = slotOf(s, slot).open
pure def mergeSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, open: false, merged: true }, s)
pure def canCloseSlot(s: StandingState, slot: Slot): bool = slotOf(s, slot).open
pure def closeSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, open: false, closed: true, closedInWindow: not(p.windowOver) }, s)
pure def canReopenSlot(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.closed and not(p.merged)
pure def reopenSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, open: true, closed: false, closedInWindow: false, seen: false, graceOver: false }, s)
pure def canLabelSlot(s: StandingState, slot: Slot): bool = not(slotOf(s, slot).labelled)
pure def labelSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, labelled: true }, s)
pure def canUnlabelSlot(s: StandingState, slot: Slot): bool = slotOf(s, slot).labelled
pure def unlabelSlot(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, labelled: false, seen: false, graceOver: false }, s)
pure def canEndWindow(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.covered and not(p.windowOver)
pure def endWindow(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, windowOver: true }, s)
pure def canEndGrace(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.seen and not(p.graceOver)
pure def endGrace(s: StandingState, slot: Slot): StandingState =
  val p = slotOf(s, slot)
  withSlot(slot, { ...p, graceOver: true }, s)
pure def canCheckCover(s: StandingState, slot: Slot): bool =
  val p = slotOf(s, slot)
  p.covered and (p.cover == Watch or p.cover == PendingStrike)
pure def checkCover(s: StandingState, slot: Slot): StandingState =
  withSlot(slot, checkedSlot(slotOf(s, slot)), s)
pure def canDecideOutcome(s: StandingState): bool = dueOutcomeOf(s) != NoOutcome
pure def decideOutcome(s: StandingState): StandingState = { ...s, outcome: dueOutcomeOf(s) }
pure def canSendOutcome(s: StandingState): bool = s.outcome == RefundDue or s.outcome == KeptDue
pure def sendOutcome(s: StandingState): StandingState =
  { ...s,
    outcome: if (s.outcome == KeptDue) Kept else Refunded,
    keptSent: s.keptSent + (if (s.outcome == KeptDue) 1 else 0),
    refundSent: s.refundSent + (if (s.outcome == RefundDue) 1 else 0) }
pure def slotConsistent(p: CoverSlot): bool =
  (p.covered implies p.cover != Uncovered) and (not(p.covered) implies p.cover == Uncovered)
pure def alwaysOneOutcomeAtMostOnce(s: StandingState): bool =
  s.keptSent >= 0 and s.refundSent >= 0 and s.keptSent + s.refundSent <= 1
  and (s.keptSent == 1 implies s.outcome == Kept)
  and (s.refundSent == 1 implies s.outcome == Refunded)
  and ((s.outcome == NoOutcome or s.outcome == RefundDue or s.outcome == KeptDue) implies (s.keptSent == 0 and s.refundSent == 0))
  and (s.outcome == Kept implies s.keptSent == 1)
  and (s.outcome == Refunded implies s.refundSent == 1)
pure def alwaysKeptOnlyAfterStrike(s: StandingState): bool =
  (s.keptSent == 1 or s.outcome == KeptDue or s.outcome == Kept) implies strikeHappened(s)
pure def alwaysRefundOnlyAfterWait(s: StandingState): bool =
  (s.refundSent == 1 or s.outcome == RefundDue or s.outcome == Refunded) implies
    (coverEnded(s) and s.waitOver and allCoveredClear(s))
pure def alwaysUnpaidCoversNothing(s: StandingState): bool =
  slotConsistent(s.pr0) and slotConsistent(s.pr1)
  and (s.row != PaidRow implies (s.outcome == NoOutcome and not(s.pr0.covered) and not(s.pr1.covered)
    and not(s.withdrawn) and not(s.expired) and not(s.waitOver) and s.keptSent == 0 and s.refundSent == 0))
pure def alwaysStrikeIsFinal(s: StandingState): bool =
  strikeHappened(s) implies (s.outcome == NoOutcome or s.outcome == KeptDue or s.outcome == Kept)
pure def sometimesCoveredAndRefunded(s: StandingState): bool =
  s.outcome == Refunded and s.refundSent == 1 and s.keptSent == 0 and s.pr0.covered
pure def sometimesStrikeKeepsDeposit(s: StandingState): bool =
  s.outcome == Kept and s.keptSent == 1 and s.refundSent == 0
pure def sometimesCapAsksSecondPull(s: StandingState): bool =
  s.pr0.covered and s.pr1.asked and not(s.pr1.covered)
pure def sometimesExpiryRefunds(s: StandingState): bool =
  s.expired and s.outcome == RefundDue
pure def sometimesCancelledCoversNothing(s: StandingState): bool =
  s.row == CancelledRow and not(s.pr0.covered)
pure val eval_witness_sometimesCoveredAndRefunded = (
  "recordFirstMerge", "postRow", "payRow", ("openSlot", FirstSlot), ("coverSlot", FirstSlot),
  ("mergeSlot", FirstSlot), ("checkCover", FirstSlot), "requestWithdraw", ("endWindow", FirstSlot),
  "passWait", "decideOutcome", "sendOutcome"
)
pure val eval_witness_sometimesStrikeKeepsDeposit = (
  "recordFirstMerge", "postRow", "payRow", ("openSlot", FirstSlot), ("coverSlot", FirstSlot),
  ("closeSlot", FirstSlot), ("labelSlot", FirstSlot), ("checkCover", FirstSlot), ("endGrace", FirstSlot),
  ("checkCover", FirstSlot), "decideOutcome", "sendOutcome"
)
pure val eval_witness_sometimesCapAsksSecondPull = (
  "recordFirstMerge", "postRow", "payRow", ("openSlot", FirstSlot), ("coverSlot", FirstSlot),
  ("openSlot", SecondSlot), ("askSlot", SecondSlot)
)
pure val eval_witness_sometimesExpiryRefunds = (
  "recordFirstMerge", "postRow", "payRow", "expireDeposit", "passWait", "decideOutcome"
)
pure val eval_witness_sometimesCancelledCoversNothing = ("postRow", "cancelRow")
pure val slotValues = Set(FirstSlot, SecondSlot)
```

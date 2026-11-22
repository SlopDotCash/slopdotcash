# Submission fee deposits of pull requests

PRD section 6, "Submission fee deposits" (operator decisions of 18 and
21 November 2026): an outside contributor whose project asks a refundable
submission fee deposits it into the published `SubmissionDeposits`
contract of Base or Robinhood Chain, naming the pull request's item hash.
The submission-fee Worker of `apps/fees` records each deposit from the
contract's events, judges whether it pays its pull request, marks the pull
request paid, copies what Slopbot decided onto the deposit and writes the
final state the contract's finalized events prove. It decides nothing about
merges or closes: `submission_fee_items` and its `refund_due` and `kept_due`
outcomes are [Slopbot's](../slopbot/submissionFeeGate.md). Sources at Slop
development `8660a6121`: `src/lib/submission-fee.mjs`
(`submissionDepositCounts`, `submissionResolveAction`),
`workers/submission-fee/core.ts` (`scan`, `judge`, `plan`),
`workers/submission-fee/store.ts`, migrations `0139_submission_fee_deposits.sql`
and `0141_submission_fee_items.sql`, and development's own model
`formal/models/fees/submission_fee_deposit.qnt` (#3053, #3061, #3092, #3186).

The published terms (networks, chain ids, confirmations, contracts, start
blocks, the token table, where a kept fee goes, the stablecoin fee and the
SLOP amount due at a block time, the 24-hour unknown-item grace) are
[the submission fee terms](../backend/submissionFeeTerms.md). Amounts are
base units above the generated core's safe integers (75 SLOP is 7.5e19),
so the shell compares them with the `//@` bigint kernels of those terms and
this spec reads the results as facts: the token's kind in the terms'
table (`TokenKind`: the network's stablecoin, SLOP or `NoToken`), whether
the kept destination is the one its kind needs, whether the item's fee is a positive amount, whether a SLOP
rate was in force at the block time, and whether the amount reaches what is
due. A deposit that names a security report instead is the
[report deposit](./submissionFeeReportDeposits.md); what the resolver signs
and sends is [the resolver's sends](./submissionFeeSends.md).

One instance follows one deposit, keyed by its network and contract deposit
id, and the pull request item it names. The chain (`Chain`) makes, confirms,
finalizes, reorganises, resolves and reclaims the deposit; Slopbot asks a
fee, takes an unpaid ask back and decides an outcome; the Worker records,
judges, marks what is due and writes final states. Only the Worker's own
reads of the contract, its finalized receipts and the item table assert
those facts.

## Story: Judge each deposit against the pull request it names

> As an outside contributor, I want my deposit to pay for my pull request
> only when it meets the published terms, and to come back to me otherwise,
> so that a fee is never kept for something I did not owe.

### A deposit pays its pull request only when it meets every term, and only one deposit pays it

The judgement checks, in this order: the token is in the network's table
(`token_not_accepted`), the kept destination is the fee wallet for a
stablecoin and the burn address for SLOP (`wrong_kept_to`), Slop asked a fee
for the item (`unknown_item`), the item's fee is a positive amount
(`item_fee_invalid`), for SLOP a rate was in force at the deposit's block
time (`no_slop_rate`), the amount is at least what is due: the item's
stablecoin amount for a stablecoin, the SLOP amount due at the block time
for SLOP (`amount_below_due`), no other deposit paid the item
(`item_already_paid`) and Slopbot has not decided it unless this deposit
paid it (`item_already_decided`). The token and the destination need no
pull request, so a deposit of another token never waits for one.

A deposit that counts marks its pull request paid first, and only an item
that is unpaid and undecided, or already paid by this very deposit, is
marked; only then is the deposit recorded as accepted, so two deposits never
both pay one pull request. A deposit whose item Slop has not asked a fee for
waits 24 hours after it is finalized, in case the ask is still on its way,
and is then refused; every other refusal is immediate, even before
finality. At most 200 deposits are judged per network and run, those whose
item is known first. A judgement is bound to the contents it judged: a
deposit the chain later reports with other contents loses it.

```quint
import submissionFeeTerms as T from "../backend/submissionFeeTerms"
type Refusal = NoRefusal | TokenNotAccepted | WrongKeptTo | UnknownItem | ItemFeeInvalid | NoSlopRate | AmountBelowDue
  | ItemAlreadyPaid | ItemAlreadyDecided | ReportWrongNetwork | ReportTokenNotSlop | ReportAmountInvalid
type PaidBy = Unpaid | ThisDeposit | OtherDeposit
type DepositFacts = { kind: T::TokenKind, keptToMatches: bool, itemKnown: bool, itemFeePositive: bool, rateInForce: bool,
  paidAtLeastDue: bool, paidBy: PaidBy, decided: bool }
pure val judgedPerRun = 200
pure def depositVerdict(verdictFacts: DepositFacts): Refusal =
  if (verdictFacts.kind == T::NoToken) TokenNotAccepted
  else if (not(verdictFacts.keptToMatches)) WrongKeptTo
  else if (not(verdictFacts.itemKnown)) UnknownItem
  else if (not(verdictFacts.itemFeePositive)) ItemFeeInvalid
  else if (verdictFacts.kind == T::SlopToken and not(verdictFacts.rateInForce)) NoSlopRate
  else if (not(verdictFacts.paidAtLeastDue)) AmountBelowDue
  else if (verdictFacts.paidBy == OtherDeposit) ItemAlreadyPaid
  else if (verdictFacts.paidBy != ThisDeposit and verdictFacts.decided) ItemAlreadyDecided
  else NoRefusal
pure def lawUnlistedTokenRefusedAtOnce(verdictFacts: DepositFacts): bool =
  verdictFacts.kind == T::NoToken implies depositVerdict(verdictFacts) == TokenNotAccepted
pure def lawSecondDepositPaysNothing(verdictFacts: DepositFacts): bool =
  verdictFacts.paidBy == OtherDeposit implies depositVerdict(verdictFacts) != NoRefusal
pure def lawAcceptedMeetsEveryTerm(verdictFacts: DepositFacts): bool = depositVerdict(verdictFacts) == NoRefusal implies
  (verdictFacts.kind != T::NoToken and verdictFacts.keptToMatches and verdictFacts.itemKnown and verdictFacts.itemFeePositive
    and verdictFacts.paidAtLeastDue and (verdictFacts.kind == T::SlopToken implies verdictFacts.rateInForce)
    and verdictFacts.paidBy != OtherDeposit and (verdictFacts.decided implies verdictFacts.paidBy == ThisDeposit))
pure val verdictFactsValues = Set(
  { kind: T::StableToken, keptToMatches: true, itemKnown: true, itemFeePositive: true, rateInForce: false, paidAtLeastDue: true, paidBy: Unpaid, decided: false },
  { kind: T::SlopToken, keptToMatches: true, itemKnown: true, itemFeePositive: true, rateInForce: false, paidAtLeastDue: true, paidBy: Unpaid, decided: false },
  { kind: T::SlopToken, keptToMatches: true, itemKnown: true, itemFeePositive: true, rateInForce: true, paidAtLeastDue: true, paidBy: ThisDeposit, decided: true },
  { kind: T::StableToken, keptToMatches: true, itemKnown: true, itemFeePositive: true, rateInForce: true, paidAtLeastDue: true, paidBy: OtherDeposit, decided: true },
  { kind: T::StableToken, keptToMatches: true, itemKnown: true, itemFeePositive: true, rateInForce: true, paidAtLeastDue: true, paidBy: Unpaid, decided: true },
  { kind: T::StableToken, keptToMatches: true, itemKnown: false, itemFeePositive: false, rateInForce: true, paidAtLeastDue: false, paidBy: Unpaid, decided: false },
  { kind: T::NoToken, keptToMatches: true, itemKnown: true, itemFeePositive: true, rateInForce: true, paidAtLeastDue: true, paidBy: Unpaid, decided: false })
```

### What may be sent for a deposit is the pull request row's due outcome or a refund

Nothing is sent before a deposit is finalized and judged, once it has left
the open states (`open`, `refund_due`, `kept_due`), or ever for a token
outside the table: the resolver makes no call into a token nobody reviewed,
and its payer reclaims it from the contract after 30 days. A refused deposit
of an accepted token is refunded. An accepted one is refunded when its own
pull request's row says `refund_due`, and kept only when that row says
`kept_due` and names this very deposit as the one that paid; no other input
produces a keep. Each run copies the action onto the deposit as its due
state (`refund_due`, `kept_due`, or `open` when nothing is due) and plans the
deposits that are due and not parked, oldest first.

```quint
type DepositState = Open | RefundDue | KeptDue | Refunded | Kept | Reclaimed
type Judgement = Unjudged | Accepted | Refused
type ItemOutcome = Undecided | RefundDueOutcome | KeptDueOutcome | RefundedOutcome | KeptOutcome
type ResolveAction = NoAction | Refund | Keep
type ResolveFacts = { finalized: bool, depositState: DepositState, kind: T::TokenKind, judgement: Judgement, paidByThis: bool,
  itemOutcome: ItemOutcome }
pure def openState(depositState: DepositState): bool = depositState == Open or depositState == RefundDue or depositState == KeptDue
pure def resolveAction(resolveFacts: ResolveFacts): ResolveAction =
  if (not(resolveFacts.finalized) or not(openState(resolveFacts.depositState)) or resolveFacts.kind == T::NoToken) NoAction
  else if (resolveFacts.judgement == Refused) Refund
  else if (resolveFacts.judgement != Accepted or not(resolveFacts.paidByThis)) NoAction
  else if (resolveFacts.itemOutcome == RefundDueOutcome) Refund
  else if (resolveFacts.itemOutcome == KeptDueOutcome) Keep
  else NoAction
pure def dueStateOf(resolution: ResolveAction): DepositState =
  if (resolution == Refund) RefundDue else if (resolution == Keep) KeptDue else Open
pure def lawKeepOnlyForOwnKeptDue(resolveFacts: ResolveFacts): bool = resolveAction(resolveFacts) == Keep implies
  (resolveFacts.finalized and resolveFacts.kind != T::NoToken and resolveFacts.judgement == Accepted and resolveFacts.paidByThis
    and resolveFacts.itemOutcome == KeptDueOutcome)
pure def lawNothingBeforeFinalOrForUnlisted(resolveFacts: ResolveFacts): bool =
  (not(resolveFacts.finalized) or resolveFacts.kind == T::NoToken) implies resolveAction(resolveFacts) == NoAction
pure val resolveFactsValues = Set(
  { finalized: true, depositState: Open, kind: T::StableToken, judgement: Accepted, paidByThis: true, itemOutcome: KeptDueOutcome },
  { finalized: true, depositState: KeptDue, kind: T::SlopToken, judgement: Accepted, paidByThis: false, itemOutcome: KeptDueOutcome },
  { finalized: true, depositState: Open, kind: T::StableToken, judgement: Refused, paidByThis: false, itemOutcome: Undecided },
  { finalized: false, depositState: Open, kind: T::StableToken, judgement: Refused, paidByThis: false, itemOutcome: Undecided },
  { finalized: true, depositState: Open, kind: T::NoToken, judgement: Refused, paidByThis: false, itemOutcome: Undecided },
  { finalized: true, depositState: Kept, kind: T::StableToken, judgement: Accepted, paidByThis: true, itemOutcome: KeptOutcome },
  { finalized: true, depositState: RefundDue, kind: T::StableToken, judgement: Accepted, paidByThis: true, itemOutcome: RefundDueOutcome })
```

## Story: Follow the chain, never ahead of it

> As a contributor and as Slop, I want a deposit's record, its refund and
> its kept fee to follow only what the chain has finalized, so that no fee
> is counted or returned on evidence a reorganisation could take back.

### A deposit is recorded once confirmed and final once finalized, and a reorganised one stops paying

The scan authenticates the chain id before it reads anything. It reads the
contract's finalized events in pages of the network's scan size, oldest
first, at most 10 finalized pages per network and run from a cursor that
starts at the published start block, then at most 10 pages of `Deposited`
events above the finalized block that already have the network's
confirmations (30 on Base, 1,200 on Robinhood Chain) on top. One finalized
page, its deposits, resolutions, the removal of unfinalized rows at or below
it and the cursor are one atomic write, and the cursor never moves back. A
deposit recorded from the confirmed window is not yet final; finalization
keeps its judgement. An unfinalized row the chain no longer reports, once
the window was read to its end, is removed and unpays its pull request
while the item has no outcome; one the chain reports with other contents,
in the confirmed window or in a finalized page, is replaced by them in the
same write, loses its judgement and unpays its item likewise (`UPSERT` and
`unpayChanged` in `store.ts`). A finalized row never changes.

```quint
type Party = Chain | Slopbot | Security | Worker
type ChainState = NoDeposit | ChainOpen | ChainGone | ChainRefunded | ChainKept | ChainReclaimed
type RowStage = NoRow | ConfirmedRow | FinalRow
type ChainDeposit = { kind: T::TokenKind, keptToMatches: bool, amountCovers: bool }
type FeeDeposit = { chain: ChainState, made: ChainDeposit, confirmed: bool, finalized: bool, eventFinal: bool, row: RowStage,
  state: DepositState, judgement: Judgement, reason: Refusal, asked: bool, otherPaid: bool, paid: bool, itemOutcome: ItemOutcome,
  graceOver: bool, refundsSent: int, keptSent: int }
pure val finalizedPagesPerRun = 10
pure val confirmedPagesPerRun = 10
pure val initial: FeeDeposit = { chain: NoDeposit, made: { kind: T::StableToken, keptToMatches: false, amountCovers: false },
  confirmed: false, finalized: false, eventFinal: false, row: NoRow, state: Open, judgement: Unjudged, reason: NoRefusal,
  asked: false, otherPaid: false, paid: false, itemOutcome: Undecided, graceOver: false, refundsSent: 0, keptSent: 0 }
pure def canDeposit(d: FeeDeposit, chainDeposit: ChainDeposit, by: Party): bool = by == Chain and d.chain == NoDeposit
pure def deposit(d: FeeDeposit, chainDeposit: ChainDeposit, by: Party): FeeDeposit = { ...d, chain: ChainOpen, made: chainDeposit }
pure def canConfirm(d: FeeDeposit, by: Party): bool = by == Chain and d.chain == ChainOpen and not(d.confirmed)
pure def confirm(d: FeeDeposit, by: Party): FeeDeposit = { ...d, confirmed: true }
pure def canFinalize(d: FeeDeposit, by: Party): bool = by == Chain and d.chain == ChainOpen and d.confirmed and not(d.finalized)
pure def finalize(d: FeeDeposit, by: Party): FeeDeposit = { ...d, finalized: true }
pure def canReorganise(d: FeeDeposit, by: Party): bool = by == Chain and d.chain == ChainOpen and not(d.finalized)
pure def reorganise(d: FeeDeposit, by: Party): FeeDeposit = { ...d, chain: ChainGone }
pure def canRecordConfirmed(d: FeeDeposit, by: Party): bool = by == Worker and d.chain == ChainOpen and d.confirmed
  and not(d.finalized) and d.row == NoRow
pure def recordConfirmed(d: FeeDeposit, by: Party): FeeDeposit = { ...d, row: ConfirmedRow, state: Open }
pure def canRecordFinal(d: FeeDeposit, by: Party): bool = by == Worker and d.finalized and d.row != FinalRow
pure def recordFinal(d: FeeDeposit, by: Party): FeeDeposit = { ...d, row: FinalRow }
pure def canRemoveGone(d: FeeDeposit, by: Party): bool = by == Worker and d.chain == ChainGone and d.row == ConfirmedRow
pure def removeGone(d: FeeDeposit, by: Party): FeeDeposit =
  { ...d, row: NoRow, state: Open, judgement: Unjudged, reason: NoRefusal, paid: if (d.itemOutcome == Undecided) false else d.paid }
pure def canReplaceChanged(d: FeeDeposit, chainDeposit: ChainDeposit, by: Party): bool = by == Worker and d.chain == ChainOpen
  and d.row == ConfirmedRow and chainDeposit != d.made
pure def replaceChanged(d: FeeDeposit, chainDeposit: ChainDeposit, by: Party): FeeDeposit =
  { ...d, made: chainDeposit, row: if (d.finalized) FinalRow else ConfirmedRow, state: Open, judgement: Unjudged, reason: NoRefusal,
    paid: if (d.itemOutcome == Undecided) false else d.paid }
pure def alwaysRowFollowsChain(d: FeeDeposit): bool = (d.row != NoRow implies d.chain != NoDeposit)
  and (d.row == FinalRow implies d.finalized) and (d.finalized implies (d.chain != NoDeposit and d.chain != ChainGone and d.confirmed))
  and (d.row == NoRow implies (d.judgement == Unjudged and d.state == Open))
  and (d.graceOver implies d.row == FinalRow)
pure def sometimesReorganisedAway(d: FeeDeposit): bool = d.chain == ChainGone and d.row == NoRow and d.asked and not(d.paid)
pure val chainDepositValues = Set(
  { kind: T::StableToken, keptToMatches: true, amountCovers: true },
  { kind: T::StableToken, keptToMatches: true, amountCovers: false },
  { kind: T::SlopToken, keptToMatches: true, amountCovers: true },
  { kind: T::StableToken, keptToMatches: false, amountCovers: true },
  { kind: T::NoToken, keptToMatches: false, amountCovers: false })
pure val byValues = Set(Chain, Slopbot, Security, Worker)
```

### Slopbot asks and decides; the Worker marks paid and judges

Slopbot inserts the item when it asks a fee, deletes it only while it is
unpaid (a deposit sent after the ask was taken back pays for nothing), and
sets `refund_due` or `kept_due` only on an item a deposit paid and only once.
The Worker marks an item paid only through a deposit that counts, and
another deposit may have paid the item first. The 24-hour unknown-item grace
is the Worker's clock read against the deposit's finalization time.

```quint
pure def factsOf(d: FeeDeposit): DepositFacts = { kind: d.made.kind, keptToMatches: d.made.keptToMatches, itemKnown: d.asked,
  itemFeePositive: true, rateInForce: true, paidAtLeastDue: d.made.amountCovers,
  paidBy: if (d.paid) ThisDeposit else if (d.otherPaid) OtherDeposit else Unpaid, decided: d.itemOutcome != Undecided }
pure def counts(d: FeeDeposit): bool = d.made.kind != T::NoToken and d.made.keptToMatches and d.made.amountCovers
pure def canAsk(d: FeeDeposit, by: Party): bool = by == Slopbot and not(d.asked)
pure def ask(d: FeeDeposit, by: Party): FeeDeposit = { ...d, asked: true }
pure def canWithdrawAsk(d: FeeDeposit, by: Party): bool = by == Slopbot and d.asked and not(d.paid) and not(d.otherPaid)
  and d.itemOutcome == Undecided
pure def withdrawAsk(d: FeeDeposit, by: Party): FeeDeposit = { ...d, asked: false }
pure def canPayByOther(d: FeeDeposit, by: Party): bool = by == Worker and d.asked and not(d.paid) and not(d.otherPaid)
  and d.itemOutcome == Undecided
pure def payByOther(d: FeeDeposit, by: Party): FeeDeposit = { ...d, otherPaid: true }
pure def canDecide(d: FeeDeposit, decision: ItemOutcome, by: Party): bool = by == Slopbot and d.paid and d.itemOutcome == Undecided
  and (decision == RefundDueOutcome or decision == KeptDueOutcome)
pure def decide(d: FeeDeposit, decision: ItemOutcome, by: Party): FeeDeposit = { ...d, itemOutcome: decision }
pure def canEndGrace(d: FeeDeposit, by: Party): bool = by == Worker and d.row == FinalRow and not(d.graceOver)
pure def endGrace(d: FeeDeposit, by: Party): FeeDeposit = { ...d, graceOver: true }
pure def canJudge(d: FeeDeposit, by: Party): bool =
  val verdict = depositVerdict(factsOf(d))
  by == Worker and d.row != NoRow and d.judgement == Unjudged and (verdict != UnknownItem or (d.row == FinalRow and d.graceOver))
pure def judge(d: FeeDeposit, by: Party): FeeDeposit =
  val verdict = depositVerdict(factsOf(d))
  if (verdict == NoRefusal) { ...d, judgement: Accepted, reason: NoRefusal, paid: true }
  else { ...d, judgement: Refused, reason: verdict }
pure def alwaysOneDepositPaysOneItem(d: FeeDeposit): bool = not(d.paid and d.otherPaid) and (d.paid implies d.asked)
  and (d.judgement == Accepted implies (d.paid and counts(d) and d.reason == NoRefusal))
  and (d.judgement == Refused implies d.reason != NoRefusal)
  and (d.judgement == Unjudged implies d.reason == NoRefusal)
  and (d.itemOutcome != Undecided implies d.paid)
pure def sometimesPaidBeforeFinal(d: FeeDeposit): bool = d.paid and not(d.finalized)
pure def sometimesSecondDepositRefused(d: FeeDeposit): bool = d.reason == ItemAlreadyPaid
pure val decisionValues = Set(RefundDueOutcome, KeptDueOutcome)
```

### Final states and fee income follow the contract's finalized events

Each run copies the deposit's due state from the rule above. A deposit
becomes `refunded`, `kept` or `reclaimed` only from the contract's finalized
`Resolved` or `Reclaimed` event, and only from an open state; a `Resolved`
event of an accepted token is recorded only after its finalized receipt
shows the exact `Transfer` of the deposit's amount to the payer or to the
kept destination, while one of a token outside the table, which only the
resolver role used by hand can make, is recorded as emitted. The pull
request this deposit paid gets `kept`, or `refunded` for a refund and for a
reclaim, with the event's block time. A deposit is resolved at most once,
never both ways, and kept only when it counted, was accepted, paid its pull
request and that row said `kept_due`. A kept deposit is fee income only as
recorded here: accepted, finalized, resolved and kept (the
[composition](./composition.md) and the [purchase pool](./buybackPool.md)
read it).

```quint
pure def resolveFactsOf(d: FeeDeposit): ResolveFacts = { finalized: d.row == FinalRow, depositState: d.state, kind: d.made.kind,
  judgement: d.judgement, paidByThis: d.paid, itemOutcome: d.itemOutcome }
pure def canMarkDue(d: FeeDeposit, by: Party): bool = by == Worker and d.row == FinalRow and d.judgement != Unjudged
  and d.made.kind != T::NoToken and openState(d.state) and dueStateOf(resolveAction(resolveFactsOf(d))) != d.state
pure def markDue(d: FeeDeposit, by: Party): FeeDeposit = { ...d, state: dueStateOf(resolveAction(resolveFactsOf(d))) }
pure def canResolve(d: FeeDeposit, by: Party): bool = by == Chain and d.chain == ChainOpen and d.row == FinalRow
  and ((d.state == RefundDue and resolveAction(resolveFactsOf(d)) == Refund) or (d.state == KeptDue and resolveAction(resolveFactsOf(d)) == Keep))
pure def resolve(d: FeeDeposit, by: Party): FeeDeposit =
  if (d.state == KeptDue) { ...d, chain: ChainKept, keptSent: d.keptSent + 1 } else { ...d, chain: ChainRefunded, refundsSent: d.refundsSent + 1 }
pure def canReclaim(d: FeeDeposit, by: Party): bool = by == Chain and d.chain == ChainOpen and d.finalized
pure def reclaim(d: FeeDeposit, by: Party): FeeDeposit = { ...d, chain: ChainReclaimed }
pure def resolvedOnChain(d: FeeDeposit): bool = d.chain == ChainRefunded or d.chain == ChainKept or d.chain == ChainReclaimed
pure def canFinalizeEvent(d: FeeDeposit, by: Party): bool = by == Chain and resolvedOnChain(d) and not(d.eventFinal)
pure def finalizeEvent(d: FeeDeposit, by: Party): FeeDeposit = { ...d, eventFinal: true }
pure def finalStateOf(d: FeeDeposit): DepositState =
  if (d.chain == ChainKept) Kept else if (d.chain == ChainReclaimed) Reclaimed else Refunded
pure def canRecordResolution(d: FeeDeposit, by: Party): bool = by == Worker and d.eventFinal and d.row == FinalRow and openState(d.state)
pure def recordResolution(d: FeeDeposit, by: Party): FeeDeposit =
  { ...d, state: finalStateOf(d),
    itemOutcome: if (d.paid and (d.itemOutcome == Undecided or d.itemOutcome == RefundDueOutcome or d.itemOutcome == KeptDueOutcome))
      (if (d.chain == ChainKept) KeptOutcome else RefundedOutcome) else d.itemOutcome }
pure def keptIncome(d: FeeDeposit): bool = d.state == Kept and d.judgement == Accepted and d.row == FinalRow
pure def alwaysResolvedOnceOneWay(d: FeeDeposit): bool = d.refundsSent >= 0 and d.keptSent >= 0 and d.refundsSent + d.keptSent <= 1
  and (d.chain == ChainKept iff d.keptSent == 1) and (d.chain == ChainRefunded iff d.refundsSent == 1)
  and ((d.refundsSent + d.keptSent == 1) implies (d.finalized and d.row == FinalRow and d.made.kind != T::NoToken))
  and (d.eventFinal implies resolvedOnChain(d))
pure def alwaysKeptOnlyWhatPaidAndWasKeptDue(d: FeeDeposit): bool = d.keptSent == 1 implies
  (counts(d) and d.judgement == Accepted and d.paid and (d.itemOutcome == KeptDueOutcome or d.itemOutcome == KeptOutcome))
pure def alwaysFinalStatesFollowFinalizedEvents(d: FeeDeposit): bool =
  (not(openState(d.state)) implies (d.eventFinal and d.row == FinalRow and d.state == finalStateOf(d)))
  and (d.itemOutcome == KeptOutcome implies (d.chain == ChainKept and d.eventFinal))
  and (d.itemOutcome == RefundedOutcome implies ((d.chain == ChainRefunded or d.chain == ChainReclaimed) and d.eventFinal))
  and (keptIncome(d) implies (d.chain == ChainKept and d.eventFinal and d.keptSent == 1))
  and (d.made.kind == T::NoToken implies (d.judgement != Accepted and d.state != RefundDue and d.state != KeptDue))
pure def sometimesRefundedOnMerge(d: FeeDeposit): bool = d.state == Refunded and d.itemOutcome == RefundedOutcome
pure def sometimesKeptAsIncome(d: FeeDeposit): bool = keptIncome(d) and d.itemOutcome == KeptOutcome
pure def sometimesShortDepositRefunded(d: FeeDeposit): bool = d.state == Refunded and d.reason == AmountBelowDue
pure def sometimesUnknownItemRefunded(d: FeeDeposit): bool = d.state == Refunded and d.reason == UnknownItem
pure def sometimesUnlistedTokenReclaimed(d: FeeDeposit): bool = d.state == Reclaimed and d.reason == TokenNotAccepted
pure def sometimesReclaimRefundsItsItem(d: FeeDeposit): bool = d.state == Reclaimed and d.itemOutcome == RefundedOutcome
```

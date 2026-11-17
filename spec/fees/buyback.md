# SLOP buyback: the bridge leg of one source network

PRD section 6 BUY-01 through BUY-07 and section 11 govern this flow. Source
models include `buyback_accounting`, `buyback_bridge_order`, `buyback_market`
and `buyback_slop_accounting`; the pinned implementation is
`workers/fee-converter/{buyback,buyback-config,buyback-store,verified-buyback}.ts`
and migration `0121_fee_buyback.sql`. The production activation instant is
`2026-11-12T00:00:00.000Z`, epoch millisecond `1794441600000`, the same
clock as every other timestamp here. Staging stays off. Monetary inputs use
integer base units; USD valuation uses quote evidence from the pinned
aggregator reader. This machine owns what each send means for the buyback
ledger. In the implementation every buyback send is also a row of the
network's fee journal (`fee_conversions`), sharing its lease, nonce floor,
native reservation, rebroadcast of unknown sends and one open send per
token; this machine does not model that sharing, and binding each send here
to a row of the [conversion journal](./conversion.md) is a composition
obligation that [the buyback binding](./buybackBinding.md) states.

One instance follows one source network: Base, Ethereum or Solana. It
bridges that network's buyback share to the Robinhood Chain fee wallet and
retains the outcome of every order. The single Robinhood Chain
[purchase pool](./buybackPool.md) credits each proven arrival once and owns
every purchase and burn under one set of caps. Evidence records name their
verified source: income keys come from the owning journals (a composition
obligation), `BridgeReceipt`, `ArrivalEvidence`, `RefundEvidence` and
`CancellationEvidence` from the chain observation adapter at a finalized
block, and `BridgeQuote` from the pinned deBridge reader after every byte of
the signed transaction was checked.

## Story: Commit each share of fee income once

### Only finalized income from a named source at or after activation increases the budget

Income is a finalized conversion output into USDC, a finalized USDC fee
claim or a completed direct-award fee on this instance's own source network.
A fee in another token counts once, as its conversion output. Each source key counts once.
Recording income needs no mode: income from the activation instant counts
even while the buyback is off, and earlier income never counts.

```quint
import money as M from "../settlement/money"
import half as H from "../settlement/half"
import runtime as R from "./runtime"
type IncomeKind = ConversionOutput | UsdcClaim | DirectFee | RobinhoodFee
type IncomeKey = { kind: IncomeKind, network: R::Network, id: int }
type SendPhase = NoSend | Submitted | Unknown | Finalized | Failed
type Send = { tx: int, phase: SendPhase, amount: int }
type OrderPhase = NoOrder | Approving | Ordering | InTransit | Cancelling | Arrived | Refunded
type Spend = { id: int, at: int, amount: int, released: bool }
type OrderResult = OrderArrived | OrderRefunded | CreationFailed
type OrderOutcome = { order: int, amount: int, takeAmount: int, result: OrderResult, height: int }
type DecisionState = Quoted | Pending | Skipped | NoRoute
type BridgeReason = NoReason | DayCapReached | BelowMinimum | UnsafeValue | NoRouteFound | NativeFeeAbove | CostAbove
type BridgeDecision = { state: DecisionState, reason: BridgeReason, amount: int, live: bool, at: int }
type Buyback = { runtime: R::Runtime, source: R::Network, clock: int, income: M::Amount, sources: List[IncomeKey], incomeTimes: List[int],
  committed: M::Amount, orderPhase: OrderPhase, order: int, orderAmount: int, takeAmount: int, orderedAt: int,
  orders: List[int], approval: Send, orderSend: Send, unfilledReported: bool, outcomes: List[OrderOutcome], decisions: List[BridgeDecision],
  bridgeSpends: List[Spend], bridgeNative: List[Spend], txs: List[int], finalizedHeight: int }
pure val buybackStart = 1794441600000
pure val dayMs = 86400000
pure val deadAddress = "0x000000000000000000000000000000000000dEaD"
pure val noSend: Send = { tx: 0, phase: NoSend, amount: 0 }
pure val initial: Buyback = { runtime: R::initial, source: R::Base, clock: buybackStart, income: M::zero, sources: List(), incomeTimes: List(),
  committed: M::zero, orderPhase: NoOrder, order: 0, orderAmount: 0, takeAmount: 0, orderedAt: 0, orders: List(),
  approval: noSend, orderSend: noSend, unfilledReported: false, outcomes: List(), decisions: List(), bridgeSpends: List(), bridgeNative: List(),
  txs: List(), finalizedHeight: 0 }
pure def canSelectSource(b: Buyback, sourceNetwork: R::Network, by: R::Sender): bool = by == R::Worker and b.sources.length() == 0 and b.orders.length() == 0
  and b.txs.length() == 0 and b.orderPhase == NoOrder and sourceNetwork != b.source and sourceNetwork != R::Robinhood
  and b.decisions.length() == 0
pure def selectSource(b: Buyback, sourceNetwork: R::Network, by: R::Sender): Buyback = { ...b, source: sourceNetwork }
pure def network(b: Buyback): R::Network = b.source
pure def canAdvanceClock(b: Buyback, now: int, by: R::Sender): bool = by == R::Worker and now > b.clock
pure def advanceClock(b: Buyback, now: int, by: R::Sender): Buyback = { ...b, clock: now }
pure def incomeAllowed(b: Buyback, key: IncomeKey): bool = key.kind != RobinhoodFee and key.network == b.source
pure def canRecordIncome(b: Buyback, key: IncomeKey, incomeAmount: M::Amount, chainTime: int, by: R::Sender): bool =
  by == R::Worker and key.id > 0 and incomeAllowed(b, key) and not(b.sources.includes(key)) and M::validAmount(incomeAmount)
    and M::positiveAmount(incomeAmount) and chainTime >= buybackStart and chainTime <= b.clock
pure def recordIncome(b: Buyback, key: IncomeKey, incomeAmount: M::Amount, chainTime: int, by: R::Sender): Buyback =
  { ...b, income: M::addAmounts(b.income, incomeAmount), sources: b.sources.append(key), incomeTimes: b.incomeTimes.append(chainTime) }
pure def alwaysSourcesOnce(b: Buyback): bool = b.sources.every(k => k.id > 0 and incomeAllowed(b, k))
  and b.incomeTimes.length() == b.sources.length() and b.incomeTimes.every(t => t >= buybackStart and t <= b.clock)
pure def stepNewSourceUnseen(before: Buyback, after: Buyback): bool = after.sources == before.sources
  or (after.sources.length() == before.sources.length() + 1
    and after.sources == before.sources.append(after.sources.nthOr(before.sources.length(), noKey))
    and not(before.sources.includes(after.sources.nthOr(before.sources.length(), noKey))))
pure val noKey: IncomeKey = { kind: ConversionOutput, network: R::Base, id: 0 }
```

### The Worker configuration is a published component

```quint
pure def canPublishWorker(b: Buyback, config: R::WorkerConfig, by: R::Sender): bool = R::canPublish(b.runtime, config, by)
pure def publishWorker(b: Buyback, config: R::WorkerConfig, by: R::Sender): Buyback = { ...b, runtime: R::publish(b.runtime, config, by) }
pure def canSetReleaseVariable(b: Buyback, variable: bool, by: R::Sender): bool = R::canSetReleaseVariable(b.runtime, variable, by)
pure def setReleaseVariable(b: Buyback, variable: bool, by: R::Sender): Buyback = { ...b, runtime: R::setReleaseVariable(b.runtime, variable, by) }
pure def canVerifyReadiness(b: Buyback, readyNetwork: R::Network, by: R::Sender): bool = R::canVerifyReadiness(b.runtime, readyNetwork, by)
pure def verifyReadiness(b: Buyback, readyNetwork: R::Network, by: R::Sender): Buyback = { ...b, runtime: R::verifyReadiness(b.runtime, readyNetwork, by) }
pure def signs(b: Buyback): bool = R::buybackSigns(b.runtime, network(b))
pure def alwaysRuntimeSound(b: Buyback): bool = R::alwaysPublishedPassedPreflight(b.runtime) and R::alwaysUnpublishedInert(b.runtime)
  and R::alwaysBuybackNeedsLiveConverter(b.runtime) and R::alwaysStagingBuybackOff(b.runtime)
  and R::alwaysReadyOnlyForEnabledNetworks(b.runtime) and b.source != R::Robinhood
```

### Each evaluation that signs nothing records one outcome, once

While the buyback is not off and no order is open, a run evaluates the due
share in the pinned order: rolling daily cap reached is skipped; an amount
below 25 USDC of available buyback funds waits as pending and requests no
route; a value beyond safe integer accounting is skipped; no route is
recorded as such; a fixed bridge fee above the approved maximum or a total
bridge cost above 10% is skipped; a dry run with acceptable terms is
recorded as quoted and signs nothing. A repeated decision with the same
state, reason, amount and mode adds no record.

The 25 USDC minimum and the 10% cap are the owner's decision of 16–17
November 2026 (`BUYBACK_MIN_BRIDGE_MICRO = "25000000"`,
`BUYBACK_MAX_BRIDGE_COST_BPS = "1000"`; `docs/slop-buyback.md`, "Owner
decisions"), replacing 500 USDC and 1.5%. `costBps` is the total cost of the
order as a share of its amount: the spread between the amount and the take
amount plus the priced fixed fee, order-account rent and network fee. A
quote whose native cost cannot be priced is no quote, so it records nothing
and signs nothing. Reconciliation of open orders, refunds and arrivals never
waits on the minimum.

```quint
type BridgeRoute = RouteFound | NoRouteResult
type BridgeQuote = { route: BridgeRoute, amount: int, takeAmount: int, costBps: int, nativeFee: int }
pure val minimumBridge = 25000000
pure val maximumBridgeCostBps = 1000
pure val maximumSafeValue = 9007199254740991
pure def nativeFeeCeiling(b: Buyback): int = if (b.source == R::Solana) 50000000 else 1000000
pure def bridgeDecision(decided: DecisionState, reason: BridgeReason, b: Buyback, quote: BridgeQuote): BridgeDecision =
  { state: decided, reason: reason, amount: quote.amount, live: b.runtime.buybackMode == R::Live, at: b.clock }
pure def decisionOf(b: Buyback, quote: BridgeQuote): BridgeDecision =
  if (spentInWindow(b.bridgeSpends, b.clock) >= 5000000000) bridgeDecision(Skipped, DayCapReached, b, quote)
  else if (quote.amount < minimumBridge) bridgeDecision(Pending, BelowMinimum, b, quote)
  else if (quote.amount > maximumSafeValue) bridgeDecision(Skipped, UnsafeValue, b, quote)
  else if (quote.route == NoRouteResult) bridgeDecision(NoRoute, NoRouteFound, b, quote)
  else if (quote.nativeFee > nativeFeeCeiling(b)) bridgeDecision(Skipped, NativeFeeAbove, b, quote)
  else if (quote.costBps > maximumBridgeCostBps or quote.takeAmount > quote.amount or quote.takeAmount <= 0) bridgeDecision(Skipped, CostAbove, b, quote)
  else bridgeDecision(Quoted, NoReason, b, quote)
pure def lastDecision(b: Buyback): BridgeDecision =
  b.decisions.nthOr(b.decisions.length() - 1, { state: Quoted, reason: NoReason, amount: -1, live: false, at: 0 })
pure def canDecide(b: Buyback, quote: BridgeQuote, by: R::Sender): bool =
  by == R::Worker and R::runs(b.runtime) and b.runtime.buybackMode != R::Off and b.orderPhase == NoOrder and quote.amount >= 0
    and quote.amount <= 1000000000 and quote.costBps >= 0 and quote.nativeFee >= 0
    and M::compareAmounts(M::addAmounts(b.committed, M::smallAmount(quote.amount)), H::half(b.income).quotient) <= 0
    and (decisionOf(b, quote).state != Quoted or b.runtime.buybackMode == R::DryRun)
pure def decide(b: Buyback, quote: BridgeQuote, by: R::Sender): Buyback =
  val d = decisionOf(b, quote)
  val previous = lastDecision(b)
  if (previous.state == d.state and previous.reason == d.reason and previous.amount == d.amount and previous.live == d.live) b
  else { ...b, decisions: b.decisions.append(d) }
pure def alwaysDecisionsSignNothing(b: Buyback): bool = b.decisions.every(d => d.amount >= 0 and d.at <= b.clock
  and (d.state == Quoted implies not(d.live)) and (d.state == Pending implies d.reason == BelowMinimum))
pure def sometimesBridgePending(b: Buyback): bool = b.decisions.some(d => d.state == Pending)
pure def sometimesBridgeDryQuoted(b: Buyback): bool = b.decisions.some(d => d.state == Quoted)
pure def sometimesBridgeSkipped(b: Buyback): bool = b.decisions.some(d => d.state == Skipped)
```

## Story: Bridge the available share through one exact order at a time

### An EVM order first approves exactly its amount to the pinned bridge

Stablecoin inputs use integer micro-units; cumulative income and committed
share use full-width Amount limbs. The available share is half the
cumulative income rounded down, less every commitment. The source wallet,
receiver, order authority and refund beneficiary are the same reviewed
fee-wallet identity. Refuse an external call, affiliate fee or unknown
reserved taker, an order below 25 USDC, above the source wallet's balance
or above 1,000 USDC per run, a total
cost above 10%, or more than 5,000 USDC in the rolling 24 hours. Solana needs no
approval. A dry run quotes and signs nothing; the approval and the order
re-check the cost and every term, so a changed cost refuses either.

```quint
type BridgeOrder = { orderId: int, tx: int, amount: int, takeAmount: int, costBps: int, receiver: str, authority: str,
  beneficiary: str, externalCall: bool, affiliateFee: int, reservedTaker: str, solana: bool, nativeFee: int, balance: int }
pure def unreleased(spends: List[Spend], now: int): int = spends.foldl(0, (total, spend) =>
  total + (if (not(spend.released) and spend.at > now - dayMs and spend.at <= now) spend.amount else 0))
pure def spentInWindow(spends: List[Spend], now: int): int = unreleased(spends, now)
pure def nativeToday(spends: List[Spend], now: int): int = spends.foldl(0, (total, spend) =>
  total + (if (not(spend.released) and spend.at / dayMs == now / dayMs) spend.amount else 0))
pure def bridgeNativeAllowed(b: Buyback, request: BridgeOrder): bool =
  if (request.solana) request.nativeFee > 0 and request.nativeFee <= 50000000
    and nativeToday(b.bridgeNative, b.clock) + request.nativeFee <= 100000000
  else request.nativeFee >= 0 and request.nativeFee <= 1000000
pure def orderTermsValid(b: Buyback, request: BridgeOrder): bool =
  request.solana == (b.source == R::Solana) and request.orderId > 0 and not(b.orders.includes(request.orderId))
    and request.amount >= minimumBridge and request.amount <= 1000000000 and request.takeAmount > 0
    and request.takeAmount <= request.amount and request.balance >= 0 and request.amount <= request.balance
    and M::compareAmounts(M::addAmounts(b.committed, M::smallAmount(request.amount)), H::half(b.income).quotient) <= 0
    and request.costBps >= 0 and request.costBps <= maximumBridgeCostBps
    and request.receiver == "fees" and request.authority == "fees" and request.beneficiary == "fees"
    and not(request.externalCall) and request.affiliateFee == 0 and request.reservedTaker == ""
    and spentInWindow(b.bridgeSpends, b.clock) + request.amount <= 5000000000 and bridgeNativeAllowed(b, request)
pure def canApproveOrder(b: Buyback, request: BridgeOrder, by: R::Sender): bool =
  by == R::Worker and signs(b) and b.orderPhase == NoOrder and not(request.solana) and orderTermsValid(b, request)
    and request.tx > 0 and not(b.txs.includes(request.tx))
pure def approveOrder(b: Buyback, request: BridgeOrder, by: R::Sender): Buyback =
  { ...b, orderPhase: Approving, approval: { tx: request.tx, phase: Submitted, amount: request.amount }, txs: b.txs.append(request.tx) }
pure def canSettleApproval(b: Buyback, receipt: BridgeReceipt, by: R::Sender): bool =
  by == R::Worker and b.orderPhase == Approving and (b.approval.phase == Submitted or b.approval.phase == Unknown)
    and receipt.tx == b.approval.tx and receipt.finalized
pure def settleApproval(b: Buyback, receipt: BridgeReceipt, by: R::Sender): Buyback =
  if (receipt.succeeded) { ...b, approval: { ...b.approval, phase: Finalized } }
  else { ...b, orderPhase: NoOrder, approval: { ...b.approval, phase: Failed } }
pure def canOrder(b: Buyback, request: BridgeOrder, by: R::Sender): bool =
  by == R::Worker and signs(b) and orderTermsValid(b, request) and request.tx > 0 and not(b.txs.includes(request.tx))
    and (if (request.solana) b.orderPhase == NoOrder
      else b.orderPhase == Approving and b.approval.phase == Finalized and b.approval.amount == request.amount)
pure def order(b: Buyback, request: BridgeOrder, by: R::Sender): Buyback =
  { ...b, orderPhase: Ordering, committed: M::addAmounts(b.committed, M::smallAmount(request.amount)),
    orderAmount: request.amount, takeAmount: request.takeAmount, order: request.orderId, orders: b.orders.append(request.orderId),
    orderSend: { tx: request.tx, phase: Submitted, amount: request.amount }, txs: b.txs.append(request.tx),
    bridgeSpends: b.bridgeSpends.append({ id: request.orderId, at: b.clock, amount: request.amount, released: false }),
    bridgeNative: if (request.solana) b.bridgeNative.append({ id: request.orderId, at: b.clock, amount: request.nativeFee, released: false }) else b.bridgeNative }
pure def sometimesApprovalRefusedCostChange(b: Buyback): bool = b.orderPhase == Approving and b.approval.phase == Finalized
pure def sometimesMinimumBridgeOrdered(b: Buyback): bool = b.orderPhase != NoOrder and b.orderAmount == minimumBridge
```

### A deposit is in transit only from its finalized order receipt; a failed order releases its share

A lost response leaves the send unknown and its share committed. A finalized
failure of the order transaction releases its commitment and its rolling
exposure, and the same share may be ordered again.

```quint
type BridgeReceipt = { tx: int, succeeded: bool, finalized: bool }
pure def canLoseSend(b: Buyback, tx: int, by: R::Sender): bool =
  by == R::Worker and ((b.approval.tx == tx and b.approval.phase == Submitted) or (b.orderSend.tx == tx and b.orderSend.phase == Submitted))
pure def loseResponse(s: Send, tx: int): Send = if (s.tx == tx and s.phase == Submitted) { ...s, phase: Unknown } else s
pure def loseSend(b: Buyback, tx: int, by: R::Sender): Buyback = { ...b, approval: loseResponse(b.approval, tx), orderSend: loseResponse(b.orderSend, tx) }
pure def release(spends: List[Spend], id: int): List[Spend] = spends.listMap(s => if (s.id == id) { ...s, released: true } else s)
pure def canSettleOrder(b: Buyback, receipt: BridgeReceipt, by: R::Sender): bool =
  by == R::Worker and b.orderPhase == Ordering and (b.orderSend.phase == Submitted or b.orderSend.phase == Unknown)
    and receipt.tx == b.orderSend.tx and receipt.finalized
pure def settleOrder(b: Buyback, receipt: BridgeReceipt, by: R::Sender): Buyback =
  if (receipt.succeeded) { ...b, orderPhase: InTransit, orderSend: { ...b.orderSend, phase: Finalized }, orderedAt: b.clock }
  else { ...b, orderPhase: NoOrder, orderSend: { ...b.orderSend, phase: Failed },
    committed: M::subtractAmounts(b.committed, M::smallAmount(b.orderAmount)),
    bridgeSpends: release(b.bridgeSpends, b.order), bridgeNative: release(b.bridgeNative, b.order),
    outcomes: b.outcomes.append({ order: b.order, amount: b.orderAmount, takeAmount: b.takeAmount, result: CreationFailed, height: 0 }) }
pure def sometimesOrderCreationFailed(b: Buyback): bool = b.orderSend.phase == Failed
```

### An unfilled order stays in transit until fulfillment or refund is proven

The Worker has no cancellation action. An owner cancellation sent from
Robinhood Chain, observed at a finalized block, moves the order to
cancelling without changing any budget, and a cancelling order cannot
arrive. Fulfillment of exactly the order's take amount at a finalized
Robinhood Chain block is retained as the order's outcome; the purchase pool
credits it once. A refund needs finalized source-network evidence of the
full deposit and releases its commitment. Every order outcome is retained
permanently. An order still unfilled an hour after its deposit is reported
once.

```quint
type ArrivalEvidence = { order: int, amount: int, receiver: str, height: int, finalized: bool }
type RefundEvidence = { order: int, amount: int, beneficiary: str, height: int, finalized: bool }
type CancellationEvidence = { order: int, height: int, finalized: bool }
pure val unfilledAlertMs = 3600000
pure def canObserveArrival(b: Buyback, arrival: ArrivalEvidence, by: R::Sender): bool =
  by == R::Worker and b.orderPhase == InTransit and arrival.order == b.order and arrival.amount == b.takeAmount
    and arrival.receiver == "fees" and arrival.height > 0 and arrival.finalized
pure def observeArrival(b: Buyback, arrival: ArrivalEvidence, by: R::Sender): Buyback =
  { ...b, orderPhase: Arrived, finalizedHeight: arrival.height,
    outcomes: b.outcomes.append({ order: b.order, amount: b.orderAmount, takeAmount: arrival.amount, result: OrderArrived, height: arrival.height }) }
pure def canObserveCancelling(b: Buyback, cancellation: CancellationEvidence, by: R::Sender): bool = by == R::Worker and b.orderPhase == InTransit
  and cancellation.order == b.order and cancellation.height > 0 and cancellation.finalized
pure def observeCancelling(b: Buyback, cancellation: CancellationEvidence, by: R::Sender): Buyback = { ...b, orderPhase: Cancelling }
pure def canObserveRefund(b: Buyback, refund: RefundEvidence, by: R::Sender): bool =
  by == R::Worker and (b.orderPhase == InTransit or b.orderPhase == Cancelling) and refund.order == b.order and refund.amount == b.orderAmount
    and refund.beneficiary == "fees" and refund.height > 0 and refund.finalized
pure def observeRefund(b: Buyback, refund: RefundEvidence, by: R::Sender): Buyback =
  { ...b, orderPhase: Refunded, committed: M::subtractAmounts(b.committed, M::smallAmount(b.orderAmount)),
    bridgeSpends: release(b.bridgeSpends, b.order), finalizedHeight: refund.height,
    outcomes: b.outcomes.append({ order: b.order, amount: b.orderAmount, takeAmount: 0, result: OrderRefunded, height: refund.height }) }
pure def canReportUnfilled(b: Buyback, by: R::Sender): bool = by == R::Worker and (b.orderPhase == InTransit or b.orderPhase == Cancelling)
  and not(b.unfilledReported) and b.clock - b.orderedAt >= unfilledAlertMs
pure def reportUnfilled(b: Buyback, by: R::Sender): Buyback = { ...b, unfilledReported: true }
pure def canCloseOrder(b: Buyback, by: R::Sender): bool = by == R::Worker and (b.orderPhase == Arrived or b.orderPhase == Refunded)
pure def closeOrder(b: Buyback, by: R::Sender): Buyback = { ...b, orderPhase: NoOrder, order: 0, orderAmount: 0, takeAmount: 0, orderedAt: 0,
  unfilledReported: false, approval: noSend, orderSend: noSend }
pure def sometimesInTransit(b: Buyback): bool = b.orderPhase == InTransit
pure def sometimesRefunded(b: Buyback): bool = b.orderPhase == Refunded
pure def sometimesCancellingReported(b: Buyback): bool = b.orderPhase == Cancelling and b.unfilledReported
pure def arrivedTotal(b: Buyback): int = b.outcomes.foldl(0, (t, o) => if (o.result == OrderArrived) t + o.takeAmount else t)
pure def alwaysOutcomesOfOrders(b: Buyback): bool = b.outcomes.every(o => b.orders.includes(o.order) and o.amount >= minimumBridge
  and o.amount <= 1000000000 and o.takeAmount >= 0 and o.takeAmount <= o.amount
  and (o.result == OrderArrived implies o.takeAmount > 0 and o.height > 0)
  and (o.result == OrderRefunded implies o.takeAmount == 0 and o.height > 0))
pure def sometimesArrivalRetained(b: Buyback): bool = b.orderPhase == NoOrder and arrivedTotal(b) > 0
pure def stepOrderOutcomeOnce(before: Buyback, after: Buyback): bool =
  (before.orderPhase == Arrived implies after.orderPhase == Arrived or after.orderPhase == NoOrder)
    and (before.orderPhase == Refunded implies after.orderPhase == Refunded or after.orderPhase == NoOrder)
    and (before.orderPhase == Cancelling implies after.orderPhase != Arrived)
```

## Story: Continue without counting income, shares or orders twice

### Cumulative accounting stays within its shares and every journal entry is past and positive

Rolling exposure uses UTC milliseconds and an 86,400,000 millisecond window.
A released entry no longer counts. Cumulative amounts keep valid limbs,
every journal entry has a positive amount and a time no later than the
observed clock, and an ordered or in-transit deposit stays inside the
committed share, so a refund never exceeds the commitment. Retained order
outcomes and decisions are append-only. A later order follows only after
the earlier one closed, failed or was refunded.

```quint
pure def openSend(s: Send): bool = s.phase == Submitted or s.phase == Unknown
pure def alwaysShareBounded(b: Buyback): bool = M::validAmount(b.income) and M::validAmount(b.committed)
  and M::compareAmounts(b.committed, H::half(b.income).quotient) <= 0
pure def alwaysWindowLimits(b: Buyback): bool = spentInWindow(b.bridgeSpends, b.clock) <= 5000000000
  and nativeToday(b.bridgeNative, b.clock) <= 100000000
pure def alwaysJournalPastAndPositive(b: Buyback): bool = b.clock >= buybackStart
  and b.bridgeSpends.every(s => s.at >= 0 and s.at <= b.clock and s.amount > 0)
  and b.bridgeNative.every(s => s.at >= 0 and s.at <= b.clock and s.amount > 0)
pure def alwaysPendingOrderReserved(b: Buyback): bool =
  (b.orderPhase == Ordering or b.orderPhase == InTransit or b.orderPhase == Cancelling) implies
    b.orderAmount >= minimumBridge and b.orderAmount <= 1000000000 and M::compareAmounts(b.committed, M::smallAmount(b.orderAmount)) >= 0
      and b.takeAmount > 0 and b.takeAmount <= b.orderAmount
pure def stepIncomeMonotonic(before: Buyback, after: Buyback): bool = M::compareAmounts(after.income, before.income) >= 0
pure def stepSignaturesNeedLiveBuyback(before: Buyback, via: str, after: Buyback): bool =
  (via == "approveOrder" or via == "order") implies signs(before)
pure def stepJournalRetained(before: Buyback, after: Buyback): bool = after.txs.length() >= before.txs.length()
  and before.txs.every(t => after.txs.includes(t)) and before.orders.every(o => after.orders.includes(o))
  and before.sources.every(k => after.sources.includes(k)) and before.incomeTimes.every(t => after.incomeTimes.includes(t))
  and after.outcomes.length() >= before.outcomes.length() and before.outcomes.every(o => after.outcomes.includes(o))
  and after.decisions.length() >= before.decisions.length() and before.decisions.every(d => after.decisions.includes(d))
pure def sometimesSecondCycle(b: Buyback): bool = b.orders.length() >= 2
pure val nowValues = Set(buybackStart + 1, buybackStart + 3600001, buybackStart + 86400001)
pure val chainTimeValues = Set(buybackStart - 1, buybackStart, buybackStart + 1)
pure val keyValues = Set({ kind: ConversionOutput, network: R::Base, id: 1 }, { kind: UsdcClaim, network: R::Base, id: 1 },
  { kind: DirectFee, network: R::Base, id: 2 }, { kind: RobinhoodFee, network: R::Robinhood, id: 3 },
  { kind: ConversionOutput, network: R::Solana, id: 4 })
pure val incomeAmountValues = Set(List(0, 0, 0, 1), List(0, 0, 500), List(0, 0, 0, 2))
pure val sourceNetworkValues = Set(R::Robinhood, R::Solana, R::Ethereum)
pure val txValues = Set(21, 22, 23, 24, 25, 26, 27, 28)
pure val readyNetworkValues = Set(R::Base, R::Robinhood, R::Solana)
pure val variableValues = Set(true)
pure val byValues = Set(R::ReleaseWorkflow, R::Owner, R::Worker)
pure val configValues = Set(R::liveAll, { ...R::liveAll, source: 2, converterMode: R::DryRun, buybackMode: R::DryRun },
  { ...R::liveAll, source: 3, buybackMode: R::Off })
pure val requestValues = Set(
  { orderId: 1, tx: 21, amount: 500000000, takeAmount: 495000000, costBps: 150, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000, balance: 600000000 },
  { orderId: 1, tx: 22, amount: 500000000, takeAmount: 495000000, costBps: 150, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000, balance: 600000000 },
  { orderId: 2, tx: 23, amount: 500000000, takeAmount: 495000000, costBps: 0, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: true, nativeFee: 40000000, balance: 600000000 },
  { orderId: 2, tx: 23, amount: 500000000, takeAmount: 495000000, costBps: 1001, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000, balance: 600000000 },
  { orderId: 2, tx: 24, amount: 500000000, takeAmount: 495000000, costBps: 0, receiver: "wrong", authority: "fees", beneficiary: "fees",
    externalCall: true, affiliateFee: 1, reservedTaker: "unknown", solana: false, nativeFee: 1000, balance: 600000000 },
  { orderId: 4, tx: 28, amount: 500000000, takeAmount: 495000000, costBps: 0, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: true, nativeFee: 40000000, balance: 600000000 },
  { orderId: 3, tx: 26, amount: 500000000, takeAmount: 495000000, costBps: 100, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000, balance: 600000000 },
  { orderId: 3, tx: 27, amount: 500000000, takeAmount: 495000000, costBps: 100, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000, balance: 600000000 },
  { orderId: 5, tx: 25, amount: 25000000, takeAmount: 22500000, costBps: 1000, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: true, nativeFee: 40000000, balance: 25000000 },
  { orderId: 3, tx: 26, amount: 500000000, takeAmount: 495000000, costBps: 100, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000, balance: 499999999 })
pure val receiptValues = Set({ tx: 21, succeeded: true, finalized: true }, { tx: 22, succeeded: true, finalized: true },
  { tx: 22, succeeded: false, finalized: true }, { tx: 23, succeeded: true, finalized: true }, { tx: 24, succeeded: false, finalized: true },
  { tx: 25, succeeded: true, finalized: true }, { tx: 25, succeeded: false, finalized: true }, { tx: 21, succeeded: true, finalized: false },
  { tx: 26, succeeded: true, finalized: true }, { tx: 27, succeeded: true, finalized: true },
  { tx: 23, succeeded: false, finalized: true }, { tx: 28, succeeded: true, finalized: true })
pure val arrivalValues = Set({ order: 1, amount: 495000000, receiver: "fees", height: 2, finalized: true },
  { order: 2, amount: 495000000, receiver: "fees", height: 2, finalized: true },
  { order: 1, amount: 500000000, receiver: "fees", height: 2, finalized: true })
pure val refundValues = Set({ order: 1, amount: 500000000, beneficiary: "fees", height: 3, finalized: true },
  { order: 2, amount: 500000000, beneficiary: "fees", height: 3, finalized: true })
pure val cancellationValues = Set({ order: 1, height: 4, finalized: true }, { order: 1, height: 4, finalized: false })
pure val quoteValues = Set(
  { route: RouteFound, amount: 500000000, takeAmount: 495000000, costBps: 100, nativeFee: 1000 },
  { route: RouteFound, amount: 20000000, takeAmount: 19800000, costBps: 100, nativeFee: 1000 },
  { route: RouteFound, amount: 25000000, takeAmount: 22500000, costBps: 1000, nativeFee: 1000 },
  { route: NoRouteResult, amount: 500000000, takeAmount: 0, costBps: 0, nativeFee: 0 },
  { route: RouteFound, amount: 500000000, takeAmount: 450000000, costBps: 1001, nativeFee: 1000 })
pure val weight_publishWorker = 4
pure val weight_verifyReadiness = 4
pure val weight_recordIncome = 6
pure val weight_approveOrder = 5
pure val weight_order = 6
pure val weight_settleApproval = 5
pure val weight_settleOrder = 5
pure val weight_observeArrival = 5
pure val weight_decide = 5
```

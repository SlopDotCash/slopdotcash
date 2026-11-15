# SLOP buyback and burn

PRD section 6 BUY-01 through BUY-07 and section 11 govern this flow. Source
models include `buyback_accounting`, `buyback_bridge_order`, `buyback_market`
and `buyback_slop_accounting`; the pinned implementation is
`workers/fee-converter/{buyback,buyback-config,buyback-store,verified-buyback}.ts`
and migration `0121_fee_buyback.sql`. The production activation instant is
`2026-11-12T00:00:00.000Z`, epoch millisecond `1794441600000`, the same
clock as every other timestamp here. Staging stays off. Monetary inputs use
integer base units; USD valuation uses quote evidence from the pinned
aggregator reader. Every send shares the fee journal of the
[conversion](./conversion.md) instance of its network: it is journaled
before broadcast, an unknown send is rebroadcast unchanged, and one open send
per token blocks the next. This machine owns what each send means for the
buyback ledger.

One instance follows one source network. A Base, Ethereum or Solana instance
bridges its share and also follows that order's fill, purchase and burn on
Robinhood Chain. A Robinhood Chain instance spends the buyback share of fees
received there. Evidence records name their verified source: income keys come
from the owning journals (composition obligations listed in the report),
`OrderReceipt`, `SendReceipt`, `ArrivalEvidence` and `RefundEvidence` from
the chain observation adapter at a finalized block, and quotes from the
pinned deBridge and swap readers after every byte of the signed transaction
was checked.

## Story: Commit each share of fee income once

### Only finalized income from a named source at or after activation increases the budget

Income is a finalized conversion output into USDC, a finalized USDC fee
claim or a completed direct-award fee on a source network, and a finalized
fee received on Robinhood Chain for that instance. A fee in another token
counts once, as its conversion output. Each source key counts once.
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
type Buyback = { runtime: R::Runtime, source: R::Network, sourceIsRobinhood: bool, clock: int, income: M::Amount, sources: List[IncomeKey], incomeTimes: List[int],
  committed: M::Amount, orderPhase: OrderPhase, order: int, orderAmount: int, takeAmount: int, orderedAt: int,
  orders: List[int], approval: Send, orderSend: Send, unfilledReported: bool, credit: int,
  purchase: Send, purchaseMinimum: M::Amount, purchased: M::Amount, burnCommitted: M::Amount, burned: M::Amount,
  burn: Send, burnQuantity: M::Amount, localSlopIncome: M::Amount, localSlopCommitted: M::Amount,
  bridgeSpends: List[Spend], purchaseSpends: List[Spend], bridgeNative: List[Spend], txs: List[int], finalizedHeight: int }
pure val buybackStart = 1794441600000
pure val dayMs = 86400000
pure val deadAddress = "0x000000000000000000000000000000000000dEaD"
pure val noSend: Send = { tx: 0, phase: NoSend, amount: 0 }
pure val initial: Buyback = { runtime: R::initial, source: R::Base, sourceIsRobinhood: false, clock: buybackStart, income: M::zero, sources: List(), incomeTimes: List(),
  committed: M::zero, orderPhase: NoOrder, order: 0, orderAmount: 0, takeAmount: 0, orderedAt: 0, orders: List(),
  approval: noSend, orderSend: noSend, unfilledReported: false, credit: 0, purchase: noSend, purchaseMinimum: M::zero,
  purchased: M::zero, burnCommitted: M::zero, burned: M::zero, burn: noSend, burnQuantity: M::zero,
  localSlopIncome: M::zero, localSlopCommitted: M::zero, bridgeSpends: List(), purchaseSpends: List(), bridgeNative: List(),
  txs: List(), finalizedHeight: 0 }
pure def acquired(b: Buyback): M::Amount = M::addAmounts(b.purchased, b.localSlopCommitted)
pure def canSelectSource(b: Buyback, sourceNetwork: R::Network): bool = b.sources.length() == 0 and b.orders.length() == 0
  and b.txs.length() == 0 and b.credit == 0 and b.orderPhase == NoOrder and sourceNetwork != b.source
pure def selectSource(b: Buyback, sourceNetwork: R::Network): Buyback =
  { ...b, source: sourceNetwork, sourceIsRobinhood: sourceNetwork == R::Robinhood }
pure def network(b: Buyback): R::Network = b.source
pure def canAdvanceClock(b: Buyback, now: int): bool = now > b.clock
pure def advanceClock(b: Buyback, now: int): Buyback = { ...b, clock: now }
pure def incomeAllowed(b: Buyback, key: IncomeKey): bool =
  if (b.sourceIsRobinhood) key.kind == RobinhoodFee and key.network == R::Robinhood
  else key.kind != RobinhoodFee and key.network != R::Robinhood
pure def canRecordIncome(b: Buyback, key: IncomeKey, incomeAmount: M::Amount, chainTime: int): bool =
  key.id > 0 and incomeAllowed(b, key) and not(b.sources.includes(key)) and M::validAmount(incomeAmount)
    and M::positiveAmount(incomeAmount) and chainTime >= buybackStart and chainTime <= b.clock
pure def recordIncome(b: Buyback, key: IncomeKey, incomeAmount: M::Amount, chainTime: int): Buyback =
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
  and R::alwaysReadyOnlyForEnabledNetworks(b.runtime)
```

## Story: Bridge the available share through one exact order at a time

### An EVM order first approves exactly its amount to the pinned bridge

Stablecoin inputs use integer micro-units; cumulative income and committed
share use full-width Amount limbs. The available share is half the
cumulative income rounded down, less every commitment. The source wallet,
receiver, order authority and refund beneficiary are the same reviewed
fee-wallet identity. Refuse an external call, affiliate fee or unknown
reserved taker, an order below 500 USDC or above 1,000 USDC per run, a cost
above 1.5%, or more than 5,000 USDC in the rolling 24 hours. Solana needs no
approval. A dry run quotes and signs nothing; the approval and the order
re-check the cost and every term, so a changed cost refuses either.

```quint
type BridgeOrder = { orderId: int, tx: int, amount: int, takeAmount: int, costBps: int, receiver: str, authority: str,
  beneficiary: str, externalCall: bool, affiliateFee: int, reservedTaker: str, solana: bool, nativeFee: int }
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
  not(b.sourceIsRobinhood) and request.solana == (b.source == R::Solana) and request.orderId > 0 and not(b.orders.includes(request.orderId))
    and request.amount >= 500000000 and request.amount <= 1000000000 and request.takeAmount > 0
    and request.takeAmount <= request.amount
    and M::compareAmounts(M::addAmounts(b.committed, M::smallAmount(request.amount)), H::half(b.income).quotient) <= 0
    and request.costBps >= 0 and request.costBps <= 150
    and request.receiver == "fees" and request.authority == "fees" and request.beneficiary == "fees"
    and not(request.externalCall) and request.affiliateFee == 0 and request.reservedTaker == ""
    and spentInWindow(b.bridgeSpends, b.clock) + request.amount <= 5000000000 and bridgeNativeAllowed(b, request)
pure def canApproveOrder(b: Buyback, request: BridgeOrder): bool =
  signs(b) and b.orderPhase == NoOrder and not(request.solana) and orderTermsValid(b, request)
    and request.tx > 0 and not(b.txs.includes(request.tx))
pure def approveOrder(b: Buyback, request: BridgeOrder): Buyback =
  { ...b, orderPhase: Approving, approval: { tx: request.tx, phase: Submitted, amount: request.amount }, txs: b.txs.append(request.tx) }
pure def canSettleApproval(b: Buyback, receipt: SendReceipt): bool =
  b.orderPhase == Approving and (b.approval.phase == Submitted or b.approval.phase == Unknown)
    and receipt.tx == b.approval.tx and receipt.finalized
pure def settleApproval(b: Buyback, receipt: SendReceipt): Buyback =
  if (receipt.succeeded) { ...b, approval: { ...b.approval, phase: Finalized } }
  else { ...b, orderPhase: NoOrder, approval: { ...b.approval, phase: Failed } }
pure def canOrder(b: Buyback, request: BridgeOrder): bool =
  signs(b) and orderTermsValid(b, request) and request.tx > 0 and not(b.txs.includes(request.tx))
    and (if (request.solana) b.orderPhase == NoOrder
      else b.orderPhase == Approving and b.approval.phase == Finalized and b.approval.amount == request.amount)
pure def order(b: Buyback, request: BridgeOrder): Buyback =
  { ...b, orderPhase: Ordering, committed: M::addAmounts(b.committed, M::smallAmount(request.amount)),
    orderAmount: request.amount, takeAmount: request.takeAmount, order: request.orderId, orders: b.orders.append(request.orderId),
    orderSend: { tx: request.tx, phase: Submitted, amount: request.amount }, txs: b.txs.append(request.tx),
    bridgeSpends: b.bridgeSpends.append({ id: request.orderId, at: b.clock, amount: request.amount, released: false }),
    bridgeNative: if (request.solana) b.bridgeNative.append({ id: request.orderId, at: b.clock, amount: request.nativeFee, released: false }) else b.bridgeNative }
pure def sometimesApprovalRefusedCostChange(b: Buyback): bool = b.orderPhase == Approving and b.approval.phase == Finalized
```

### A deposit is in transit only from its finalized order receipt; a failed order releases its share

A lost response leaves the send unknown and its share committed. A finalized
failure of the order transaction releases its commitment and its rolling
exposure, and the same share may be ordered again.

```quint
type SendReceipt = { tx: int, succeeded: bool, finalized: bool }
pure def canLoseSend(b: Buyback, tx: int): bool =
  (b.approval.tx == tx and b.approval.phase == Submitted) or (b.orderSend.tx == tx and b.orderSend.phase == Submitted)
    or (b.purchase.tx == tx and b.purchase.phase == Submitted) or (b.burn.tx == tx and b.burn.phase == Submitted)
pure def loseResponse(s: Send, tx: int): Send = if (s.tx == tx and s.phase == Submitted) { ...s, phase: Unknown } else s
pure def loseSend(b: Buyback, tx: int): Buyback = { ...b, approval: loseResponse(b.approval, tx), orderSend: loseResponse(b.orderSend, tx),
  purchase: loseResponse(b.purchase, tx), burn: loseResponse(b.burn, tx) }
pure def release(spends: List[Spend], id: int): List[Spend] = spends.listMap(s => if (s.id == id) { ...s, released: true } else s)
pure def canSettleOrder(b: Buyback, receipt: SendReceipt): bool =
  b.orderPhase == Ordering and (b.orderSend.phase == Submitted or b.orderSend.phase == Unknown)
    and receipt.tx == b.orderSend.tx and receipt.finalized
pure def settleOrder(b: Buyback, receipt: SendReceipt): Buyback =
  if (receipt.succeeded) { ...b, orderPhase: InTransit, orderSend: { ...b.orderSend, phase: Finalized }, orderedAt: b.clock }
  else { ...b, orderPhase: NoOrder, orderSend: { ...b.orderSend, phase: Failed },
    committed: M::subtractAmounts(b.committed, M::smallAmount(b.orderAmount)),
    bridgeSpends: release(b.bridgeSpends, b.order), bridgeNative: release(b.bridgeNative, b.order) }
pure def sometimesOrderCreationFailed(b: Buyback): bool = b.orderSend.phase == Failed
```

### An unfilled order stays in transit until fulfillment or refund is proven

The Worker has no cancellation action. An owner cancellation sent from
Robinhood Chain moves the order to cancelling without changing any budget,
and a cancelling order cannot arrive. Fulfillment credits exactly the
order's take amount from a finalized Robinhood Chain block. A refund needs
finalized source-network evidence of the full deposit and releases its
commitment. An order still unfilled an hour after its deposit is reported
once.

```quint
type ArrivalEvidence = { order: int, amount: int, receiver: str, height: int, finalized: bool }
type RefundEvidence = { order: int, amount: int, beneficiary: str, height: int, finalized: bool }
pure val unfilledAlertMs = 3600000
pure def canObserveArrival(b: Buyback, arrival: ArrivalEvidence): bool =
  b.orderPhase == InTransit and arrival.order == b.order and arrival.amount == b.takeAmount
    and arrival.receiver == "fees" and arrival.height > 0 and arrival.finalized
pure def observeArrival(b: Buyback, arrival: ArrivalEvidence): Buyback =
  { ...b, orderPhase: Arrived, credit: b.credit + arrival.amount, finalizedHeight: arrival.height }
pure def canObserveCancelling(b: Buyback, order: int): bool = b.orderPhase == InTransit and order == b.order
pure def observeCancelling(b: Buyback, order: int): Buyback = { ...b, orderPhase: Cancelling }
pure def canObserveRefund(b: Buyback, refund: RefundEvidence): bool =
  (b.orderPhase == InTransit or b.orderPhase == Cancelling) and refund.order == b.order and refund.amount == b.orderAmount
    and refund.beneficiary == "fees" and refund.height > 0 and refund.finalized
pure def observeRefund(b: Buyback, refund: RefundEvidence): Buyback =
  { ...b, orderPhase: Refunded, committed: M::subtractAmounts(b.committed, M::smallAmount(b.orderAmount)),
    bridgeSpends: release(b.bridgeSpends, b.order), finalizedHeight: refund.height }
pure def canReportUnfilled(b: Buyback): bool = (b.orderPhase == InTransit or b.orderPhase == Cancelling)
  and not(b.unfilledReported) and b.clock - b.orderedAt >= unfilledAlertMs
pure def reportUnfilled(b: Buyback): Buyback = { ...b, unfilledReported: true }
pure def canCloseOrder(b: Buyback): bool = b.orderPhase == Arrived or b.orderPhase == Refunded
pure def closeOrder(b: Buyback): Buyback = { ...b, orderPhase: NoOrder, order: 0, orderAmount: 0, takeAmount: 0, orderedAt: 0,
  unfilledReported: false, approval: noSend, orderSend: noSend }
pure def sometimesInTransit(b: Buyback): bool = b.orderPhase == InTransit
pure def sometimesRefunded(b: Buyback): bool = b.orderPhase == Refunded
pure def sometimesCancellingReported(b: Buyback): bool = b.orderPhase == Cancelling and b.unfilledReported
pure def stepOrderOutcomeOnce(before: Buyback, after: Buyback): bool =
  (before.orderPhase == Arrived implies after.orderPhase == Arrived or after.orderPhase == NoOrder)
    and (before.orderPhase == Refunded implies after.orderPhase == Refunded or after.orderPhase == NoOrder)
    and (before.orderPhase == Cancelling implies after.orderPhase != Arrived)
```

## Story: Buy and burn only from finalized receipts

### The purchase pool combines proven arrivals and the Robinhood fee share

On Robinhood Chain the buyback share of a fee received there joins the same
purchase pool as proven arrivals; the retained half stays unconverted. A
purchase spends from the pool with output to the fee wallet. It needs at
least 25 USDG of value, at most 1% slippage and 3% price impact, at most
1,000 USDG per run and 5,000 per rolling 24 hours, and an unpaused token. The
acquired SLOP is credited only from the finalized swap receipt. A failed
swap returns its input to the pool and releases its exposure.

```quint
type PurchaseQuote = { tx: int, spent: int, minimum: M::Amount, slippageBps: int, impactBps: int, receiver: str, tokenPaused: bool }
type SwapReceipt = { tx: int, succeeded: bool, finalized: bool, output: M::Amount, toFeeWallet: bool, slopToken: bool }
pure def canReserveLocalShare(b: Buyback, amount: int): bool = b.sourceIsRobinhood and amount > 0
  and M::compareAmounts(M::addAmounts(b.committed, M::smallAmount(amount)), H::half(b.income).quotient) <= 0
pure def reserveLocalShare(b: Buyback, amount: int): Buyback =
  { ...b, committed: M::addAmounts(b.committed, M::smallAmount(amount)), credit: b.credit + amount }
pure def canPurchase(b: Buyback, quote: PurchaseQuote): bool =
  signs(b) and b.purchase.phase != Submitted and b.purchase.phase != Unknown
    and quote.tx > 0 and not(b.txs.includes(quote.tx)) and quote.spent >= 25000000 and quote.spent <= b.credit
    and quote.spent <= 1000000000 and M::validAmount(quote.minimum) and M::positiveAmount(quote.minimum)
    and quote.slippageBps >= 0 and quote.slippageBps <= 100 and quote.impactBps >= 0 and quote.impactBps <= 300
    and quote.receiver == "fees" and not(quote.tokenPaused)
    and spentInWindow(b.purchaseSpends, b.clock) + quote.spent <= 5000000000
pure def purchase(b: Buyback, quote: PurchaseQuote): Buyback =
  { ...b, credit: b.credit - quote.spent, purchase: { tx: quote.tx, phase: Submitted, amount: quote.spent },
    purchaseMinimum: quote.minimum, txs: b.txs.append(quote.tx),
    purchaseSpends: b.purchaseSpends.append({ id: quote.tx, at: b.clock, amount: quote.spent, released: false }) }
pure def canSettlePurchase(b: Buyback, swap: SwapReceipt): bool =
  (b.purchase.phase == Submitted or b.purchase.phase == Unknown) and swap.tx == b.purchase.tx and swap.finalized
    and (swap.succeeded implies M::validAmount(swap.output) and M::positiveAmount(swap.output) and swap.toFeeWallet and swap.slopToken)
pure def settlePurchase(b: Buyback, swap: SwapReceipt): Buyback =
  if (swap.succeeded) { ...b, purchase: { ...b.purchase, phase: Finalized }, purchased: M::addAmounts(b.purchased, swap.output) }
  else { ...b, purchase: { ...b.purchase, phase: Failed }, credit: b.credit + b.purchase.amount,
    purchaseSpends: release(b.purchaseSpends, b.purchase.tx) }
pure def sometimesPurchased(b: Buyback): bool = M::positiveAmount(b.purchased)
pure def sometimesPurchaseFailed(b: Buyback): bool = b.purchase.phase == Failed
pure def sometimesCombinedPool(b: Buyback): bool = b.sourceIsRobinhood and b.credit > 0 and M::positiveAmount(b.committed)
```

### Half of all acquired SLOP is burned once, and a failed burn retries the same share

A fee received in SLOP needs no purchase: its buyback share counts as
acquired. A burn sends exactly half of everything acquired, rounded down,
less every burn already committed, to the canonical dead address, with at
least 5 USDG of value. One burn is open at a time. A paused token waits. A
finalized burn adds its exact quantity to the burned total; a failed burn
releases its commitment so the same share is burned again. Total supply is
not modeled as decreasing.

```quint
type BurnRequest = { tx: int, quantity: M::Amount, value: int, destination: str, tokenPaused: bool }
pure def canReceiveSlopFee(b: Buyback, key: IncomeKey, quantity: M::Amount, chainTime: int): bool = b.sourceIsRobinhood
  and key.kind == RobinhoodFee and key.network == R::Robinhood and key.id > 0 and not(b.sources.includes(key))
  and M::validAmount(quantity) and M::positiveAmount(quantity) and chainTime >= buybackStart and chainTime <= b.clock
pure def receiveSlopFee(b: Buyback, key: IncomeKey, quantity: M::Amount, chainTime: int): Buyback =
  val total = M::addAmounts(b.localSlopIncome, quantity)
  { ...b, localSlopIncome: total, localSlopCommitted: H::half(total).quotient, sources: b.sources.append(key),
    incomeTimes: b.incomeTimes.append(chainTime) }
pure def burnDue(b: Buyback): M::Amount = M::subtractAmounts(H::half(acquired(b)).quotient, b.burnCommitted)
pure def canBurn(b: Buyback, burnRequest: BurnRequest): bool =
  signs(b) and b.burn.phase != Submitted and b.burn.phase != Unknown and burnRequest.tx > 0 and not(b.txs.includes(burnRequest.tx))
    and M::validAmount(burnRequest.quantity) and M::positiveAmount(burnRequest.quantity)
    and M::compareAmounts(b.burnCommitted, H::half(acquired(b)).quotient) <= 0
    and M::equalAmounts(burnRequest.quantity, burnDue(b)) and burnRequest.value >= 5000000
    and burnRequest.destination == deadAddress and not(burnRequest.tokenPaused)
pure def burn(b: Buyback, burnRequest: BurnRequest): Buyback =
  { ...b, burnCommitted: M::addAmounts(b.burnCommitted, burnRequest.quantity), burnQuantity: burnRequest.quantity,
    burn: { tx: burnRequest.tx, phase: Submitted, amount: 0 }, txs: b.txs.append(burnRequest.tx) }
pure def canSettleBurn(b: Buyback, receipt: SendReceipt): bool =
  (b.burn.phase == Submitted or b.burn.phase == Unknown) and receipt.tx == b.burn.tx and receipt.finalized
pure def settleBurn(b: Buyback, receipt: SendReceipt): Buyback =
  val burnedTotal = M::addAmounts(b.burned, b.burnQuantity)
  if (receipt.succeeded) { ...b, burn: { ...b.burn, phase: Finalized }, burned: burnedTotal, burnCommitted: burnedTotal, burnQuantity: M::zero }
  else { ...b, burn: { ...b.burn, phase: Failed }, burnCommitted: b.burned, burnQuantity: M::zero }
pure def sometimesBurned(b: Buyback): bool = b.burn.phase == Finalized and M::positiveAmount(b.burned)
pure def sometimesBurnRetried(b: Buyback): bool = b.burn.phase == Failed and M::positiveAmount(acquired(b))
```

## Story: Continue without counting income, shares or burns twice

### Cumulative accounting stays within its shares and every journal entry is past and positive

Rolling exposure uses UTC milliseconds and an 86,400,000 millisecond window.
A released entry no longer counts. Discovered by the proof: cumulative
amounts keep valid limbs, every journal entry has a positive amount and a
time no later than the observed clock, and an ordered or in-transit deposit
stays inside the committed share, so a refund never exceeds the commitment.

```quint
pure def openSend(s: Send): bool = s.phase == Submitted or s.phase == Unknown
pure def alwaysShareBounded(b: Buyback): bool = M::validAmount(b.income) and M::validAmount(b.committed)
  and M::compareAmounts(b.committed, H::half(b.income).quotient) <= 0
pure def alwaysBurnBounded(b: Buyback): bool = M::validAmount(b.burned) and M::validAmount(b.burnCommitted)
  and M::validAmount(b.purchased) and M::validAmount(b.burnQuantity)
  and M::compareAmounts(b.burnCommitted, H::half(acquired(b)).quotient) <= 0
  and (if (openSend(b.burn)) M::equalAmounts(b.burnCommitted, M::addAmounts(b.burned, b.burnQuantity))
    else b.burnCommitted == b.burned and b.burnQuantity == M::zero)
pure def alwaysWindowLimits(b: Buyback): bool = spentInWindow(b.bridgeSpends, b.clock) <= 5000000000
  and spentInWindow(b.purchaseSpends, b.clock) <= 5000000000 and nativeToday(b.bridgeNative, b.clock) <= 100000000
pure def alwaysJournalPastAndPositive(b: Buyback): bool = b.clock >= buybackStart
  and b.bridgeSpends.every(s => s.at >= 0 and s.at <= b.clock and s.amount > 0)
  and b.purchaseSpends.every(s => s.at >= 0 and s.at <= b.clock and s.amount > 0)
  and b.bridgeNative.every(s => s.at >= 0 and s.at <= b.clock and s.amount > 0)
pure def alwaysPendingOrderReserved(b: Buyback): bool =
  (b.orderPhase == Ordering or b.orderPhase == InTransit or b.orderPhase == Cancelling) implies
    b.orderAmount >= 500000000 and b.orderAmount <= 1000000000 and M::compareAmounts(b.committed, M::smallAmount(b.orderAmount)) >= 0
      and b.takeAmount > 0 and b.takeAmount <= b.orderAmount
pure def alwaysPoolNonNegative(b: Buyback): bool = b.credit >= 0 and (openSend(b.purchase) implies b.purchase.amount >= 25000000)
pure def alwaysLocalShareBounded(b: Buyback): bool = M::validAmount(b.localSlopIncome)
  and M::validAmount(b.localSlopCommitted) and M::compareAmounts(b.localSlopCommitted, H::half(b.localSlopIncome).quotient) <= 0
pure def alwaysSourceLegsOnly(b: Buyback): bool = b.sourceIsRobinhood implies b.orderPhase == NoOrder and b.orders.length() == 0
pure def stepIncomeMonotonic(before: Buyback, after: Buyback): bool = M::compareAmounts(after.income, before.income) >= 0
  and M::compareAmounts(after.purchased, before.purchased) >= 0 and M::compareAmounts(after.burned, before.burned) >= 0
  and M::compareAmounts(after.localSlopIncome, before.localSlopIncome) >= 0
pure def stepSignaturesNeedLiveBuyback(before: Buyback, via: str, after: Buyback): bool =
  (via == "approveOrder" or via == "order" or via == "purchase" or via == "burn") implies signs(before)
pure def stepJournalRetained(before: Buyback, after: Buyback): bool = after.txs.length() >= before.txs.length()
  and before.txs.every(t => after.txs.includes(t)) and before.orders.every(o => after.orders.includes(o))
  and before.sources.every(k => after.sources.includes(k)) and before.incomeTimes.every(t => after.incomeTimes.includes(t))
```

### Simulation samples exercise matching, refused and failed evidence

These sets bound simulation only.

```quint
pure val nowValues = Set(buybackStart + 1, buybackStart + 3600001, buybackStart + 86400001)
pure val chainTimeValues = Set(buybackStart - 1, buybackStart, buybackStart + 1)
pure val keyValues = Set({ kind: ConversionOutput, network: R::Base, id: 1 }, { kind: UsdcClaim, network: R::Base, id: 1 },
  { kind: DirectFee, network: R::Base, id: 2 }, { kind: RobinhoodFee, network: R::Robinhood, id: 3 },
  { kind: RobinhoodFee, network: R::Robinhood, id: 4 })
pure val incomeAmountValues = Set(List(0, 0, 0, 1), List(0, 0, 500), List(0, 0, 0, 2))
pure val quantityValues = Set(List(1), List(3), List(0, 1))
pure val amountValues = Set(25000000, 500000000)
pure val sourceNetworkValues = Set(R::Robinhood, R::Solana, R::Ethereum)
pure val orderValues = Set(1, 2)
pure val txValues = Set(21, 22, 23, 24, 25)
pure val readyNetworkValues = Set(R::Base, R::Robinhood, R::Solana)
pure val variableValues = Set(true)
pure val byValues = Set(R::ReleaseWorkflow, R::Owner)
pure val configValues = Set(R::liveAll, { ...R::liveAll, source: 2, converterMode: R::DryRun, buybackMode: R::DryRun },
  { ...R::liveAll, source: 3, buybackMode: R::Off })
pure val requestValues = Set(
  { orderId: 1, tx: 21, amount: 500000000, takeAmount: 495000000, costBps: 150, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000 },
  { orderId: 1, tx: 22, amount: 500000000, takeAmount: 495000000, costBps: 150, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000 },
  { orderId: 2, tx: 23, amount: 500000000, takeAmount: 495000000, costBps: 0, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: true, nativeFee: 40000000 },
  { orderId: 2, tx: 23, amount: 500000000, takeAmount: 495000000, costBps: 151, receiver: "fees", authority: "fees", beneficiary: "fees",
    externalCall: false, affiliateFee: 0, reservedTaker: "", solana: false, nativeFee: 1000 },
  { orderId: 2, tx: 24, amount: 500000000, takeAmount: 495000000, costBps: 0, receiver: "wrong", authority: "fees", beneficiary: "fees",
    externalCall: true, affiliateFee: 1, reservedTaker: "unknown", solana: false, nativeFee: 1000 })
pure val receiptValues = Set({ tx: 21, succeeded: true, finalized: true }, { tx: 22, succeeded: true, finalized: true },
  { tx: 22, succeeded: false, finalized: true }, { tx: 23, succeeded: true, finalized: true }, { tx: 24, succeeded: false, finalized: true },
  { tx: 25, succeeded: true, finalized: true }, { tx: 25, succeeded: false, finalized: true }, { tx: 21, succeeded: true, finalized: false })
pure val arrivalValues = Set({ order: 1, amount: 495000000, receiver: "fees", height: 2, finalized: true },
  { order: 2, amount: 495000000, receiver: "fees", height: 2, finalized: true },
  { order: 1, amount: 500000000, receiver: "fees", height: 2, finalized: true })
pure val refundValues = Set({ order: 1, amount: 500000000, beneficiary: "fees", height: 3, finalized: true },
  { order: 2, amount: 500000000, beneficiary: "fees", height: 3, finalized: true })
pure val quoteValues = Set(
  { tx: 24, spent: 25000000, minimum: List(5), slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false },
  { tx: 24, spent: 495000000, minimum: List(5), slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false },
  { tx: 24, spent: 25000000, minimum: List(5), slippageBps: 101, impactBps: 300, receiver: "fees", tokenPaused: false },
  { tx: 24, spent: 25000000, minimum: List(5), slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: true })
pure val swapValues = Set({ tx: 24, succeeded: true, finalized: true, output: List(6), toFeeWallet: true, slopToken: true },
  { tx: 24, succeeded: false, finalized: true, output: List(0), toFeeWallet: true, slopToken: true },
  { tx: 24, succeeded: true, finalized: true, output: List(6), toFeeWallet: false, slopToken: true })
pure val burnRequestValues = Set({ tx: 25, quantity: List(3), value: 5000000, destination: deadAddress, tokenPaused: false },
  { tx: 25, quantity: List(1), value: 5000000, destination: deadAddress, tokenPaused: false },
  { tx: 25, quantity: List(3), value: 5000000, destination: deadAddress, tokenPaused: true })
pure val weight_publishWorker = 4
pure val weight_verifyReadiness = 4
pure val weight_recordIncome = 6
pure val weight_approveOrder = 5
pure val weight_order = 6
pure val weight_settleApproval = 5
pure val weight_settleOrder = 5
pure val weight_observeArrival = 5
pure val weight_purchase = 6
pure val weight_settlePurchase = 5
pure val weight_burn = 5
pure val weight_settleBurn = 5
```

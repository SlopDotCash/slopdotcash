# SLOP purchase pool and burn on Robinhood Chain

PRD section 6 BUY-01 through BUY-07 and section 11 govern purchases and
burns. The pinned implementation is the Robinhood Chain run of
`workers/fee-converter/buyback.ts` (`arrivedCredit`, the buyback and burn
legs) and migration `0121_fee_buyback.sql`. There is one pool for the whole
buyback: every [bridge leg](./buyback.md) delivers into it, and the buyback
share of fees received on Robinhood Chain joins it. Its run cap, rolling
24-hour cap, burn minimum and rounding apply once, across every source.

Values are integer USDG micro-units; SLOP quantities are full-width Amount
limbs. Clock values are UTC epoch milliseconds from the trusted Worker clock.
Evidence records name their verified source: `ArrivalCredit` is a retained
`OrderArrived` outcome of a bridge leg (a composition obligation binds it to
that leg's `outcomes`), `RobinhoodFee` and `SlopFee` are finalized fee
receipts into the Robinhood Chain fee wallet from the chain observation
adapter, `PurchaseQuote` and `BurnRequest` come from the pinned swap and
token readers after the signed bytes were checked, and `SwapReceipt` and
`SendReceipt` are finalized receipts. As for the bridge legs, every send is
also a row of the Robinhood Chain fee journal in the implementation; binding
it to that [journal](./conversion.md) is a composition obligation that
[the composition](./composition.md) states.

## Story: Credit each proven arrival and each Robinhood share once

### The pool combines proven arrivals and the Robinhood fee share

A proven arrival of a source network's order credits exactly its take
amount, once per network and order. A fee received on Robinhood Chain at or
after activation counts once; at most half of that income is ever committed
to the pool, so the retained half stays unconverted.

```quint
import money as M from "../settlement/money"
import half as H from "../settlement/half"
import runtime as R from "./runtime"
import buyback as B from "./buyback"
type ArrivalCredit = { network: R::Network, order: int, takeAmount: int, height: int }
type RobinhoodFee = { receipt: int, amount: int, chainTime: int }
type SlopFee = { receipt: int, quantity: M::Amount, chainTime: int }
type PoolState = Quoted | Pending | Skipped | NoRoute
type PoolReason = NoReason | RunCapReached | DayCapReached | NoRouteFound | ExceedsRemaining | UnsafeValue | BelowMinimum
  | BelowGasMultiple | ImpactUnknown | ImpactAbove | SlippageOutside | TokenPaused
type PoolLeg = PurchaseLeg | BurnLeg
type PoolDecision = { leg: PoolLeg, state: PoolState, reason: PoolReason, value: int, live: bool, at: int }
type Pool = { runtime: R::Runtime, clock: int, arrivals: List[ArrivalCredit], rhIncome: M::Amount, rhReceipts: List[int],
  rhCommitted: M::Amount, credit: int, runNumber: int, runSpent: int, purchase: B::Send, purchaseMinimum: M::Amount,
  purchased: M::Amount, purchaseSpends: List[B::Spend], burnCommitted: M::Amount, burned: M::Amount, burn: B::Send,
  burnQuantity: M::Amount, localSlopIncome: M::Amount, localSlopCommitted: M::Amount, slopReceipts: List[int],
  decisions: List[PoolDecision], txs: List[int] }
pure val initial: Pool = { runtime: R::initial, clock: B::buybackStart, arrivals: List(), rhIncome: M::zero, rhReceipts: List(),
  rhCommitted: M::zero, credit: 0, runNumber: 0, runSpent: 0, purchase: B::noSend, purchaseMinimum: M::zero, purchased: M::zero,
  purchaseSpends: List(), burnCommitted: M::zero, burned: M::zero, burn: B::noSend, burnQuantity: M::zero,
  localSlopIncome: M::zero, localSlopCommitted: M::zero, slopReceipts: List(), decisions: List(), txs: List() }
pure val runCap = 1000000000
pure val dayCap = 5000000000
pure def acquired(p: Pool): M::Amount = M::addAmounts(p.purchased, p.localSlopCommitted)
pure def arrivalSeen(p: Pool, arrival: ArrivalCredit): bool = p.arrivals.some(a => a.network == arrival.network and a.order == arrival.order)
pure def canAdvanceClock(p: Pool, now: int): bool = now > p.clock
pure def advanceClock(p: Pool, now: int): Pool = { ...p, clock: now }
pure def canCreditArrival(p: Pool, arrival: ArrivalCredit): bool = arrival.network != R::Robinhood and arrival.order > 0
  and arrival.takeAmount > 0 and arrival.takeAmount <= 1000000000 and arrival.height > 0 and not(arrivalSeen(p, arrival))
pure def creditArrival(p: Pool, arrival: ArrivalCredit): Pool =
  { ...p, arrivals: p.arrivals.append(arrival), credit: p.credit + arrival.takeAmount }
pure def canRecordRobinhoodFee(p: Pool, robinhoodFee: RobinhoodFee): bool = robinhoodFee.receipt > 0
  and not(p.rhReceipts.includes(robinhoodFee.receipt)) and robinhoodFee.amount > 0
  and robinhoodFee.chainTime >= B::buybackStart and robinhoodFee.chainTime <= p.clock
pure def recordRobinhoodFee(p: Pool, robinhoodFee: RobinhoodFee): Pool =
  { ...p, rhIncome: M::addAmounts(p.rhIncome, M::smallAmount(robinhoodFee.amount)), rhReceipts: p.rhReceipts.append(robinhoodFee.receipt) }
pure def canReserveLocalShare(p: Pool, amount: int): bool = amount > 0
  and M::compareAmounts(M::addAmounts(p.rhCommitted, M::smallAmount(amount)), H::half(p.rhIncome).quotient) <= 0
pure def reserveLocalShare(p: Pool, amount: int): Pool =
  { ...p, rhCommitted: M::addAmounts(p.rhCommitted, M::smallAmount(amount)), credit: p.credit + amount }
pure def arrivedCredit(p: Pool): int = p.arrivals.foldl(0, (t, a) => t + a.takeAmount)
pure def alwaysArrivalsOnce(p: Pool): bool = p.arrivals.every(a => a.network != R::Robinhood and a.takeAmount > 0
  and p.arrivals.every(o => (o.network == a.network and o.order == a.order) implies o == a))
pure def alwaysLocalShareBounded(p: Pool): bool = M::validAmount(p.rhIncome) and M::validAmount(p.rhCommitted)
  and M::compareAmounts(p.rhCommitted, H::half(p.rhIncome).quotient) <= 0
pure def sometimesCombinedPool(p: Pool): bool = p.arrivals.length() > 0 and M::positiveAmount(p.rhCommitted) and p.credit > 0
```

### The Worker configuration is a published component

```quint
pure def canPublishWorker(p: Pool, config: R::WorkerConfig, by: R::Sender): bool = R::canPublish(p.runtime, config, by)
pure def publishWorker(p: Pool, config: R::WorkerConfig, by: R::Sender): Pool = { ...p, runtime: R::publish(p.runtime, config, by) }
pure def canSetReleaseVariable(p: Pool, variable: bool, by: R::Sender): bool = R::canSetReleaseVariable(p.runtime, variable, by)
pure def setReleaseVariable(p: Pool, variable: bool, by: R::Sender): Pool = { ...p, runtime: R::setReleaseVariable(p.runtime, variable, by) }
pure def canVerifyReadiness(p: Pool, listedWallet: int, by: R::Sender): bool =
  R::canVerifyReadiness(p.runtime, R::Robinhood, listedWallet, by)
pure def verifyReadiness(p: Pool, listedWallet: int, by: R::Sender): Pool =
  { ...p, runtime: R::verifyReadiness(p.runtime, R::Robinhood, listedWallet, by) }
pure def signs(p: Pool): bool = R::buybackSigns(p.runtime, R::Robinhood)
pure def alwaysRuntimeSound(p: Pool): bool = R::alwaysPublishedPassedPreflight(p.runtime) and R::alwaysUnpublishedInert(p.runtime)
  and R::alwaysBuybackNeedsLiveConverter(p.runtime) and R::alwaysStagingBuybackOff(p.runtime)
```

## Story: Buy SLOP only within one set of caps and only from receipts

### Each purchase evaluation records why it waits, in the pinned order

A Robinhood Chain run starts with an empty run total. Its purchase
evaluation checks, in order: run cap or rolling daily cap reached (skipped);
no route; a quote above the remaining cap or beyond safe integer accounting
(skipped); below 25 USDG or below ten times the gas cost (pending, waits in
the pool); unknown price impact or impact above 3% (skipped); a minimum
output outside 1% slippage (skipped); a dry run with acceptable terms is
recorded as quoted and signs nothing. A repeated decision with the same
leg, state, reason, value and mode adds no record.

```quint
type RouteResult = RouteFound | NoRouteResult
type PurchaseQuote = { route: RouteResult, tx: int, spent: int, minimum: M::Amount, gasValue: int, slippageBps: int,
  impactBps: int, receiver: str, tokenPaused: bool, balance: int }
pure val maximumSafeValue = 9007199254740991
pure def remaining(p: Pool): int =
  val runLeft = runCap - p.runSpent
  val dayLeft = dayCap - B::spentInWindow(p.purchaseSpends, p.clock)
  if (runLeft < dayLeft) runLeft else dayLeft
pure def purchaseDecision(p: Pool, quote: PurchaseQuote): PoolDecision =
  val base = { leg: PurchaseLeg, state: Skipped, reason: NoReason, value: quote.spent, live: p.runtime.buybackMode == R::Live, at: p.clock }
  if (remaining(p) <= 0) { ...base, reason: if (runCap - p.runSpent <= 0) RunCapReached else DayCapReached }
  else if (quote.route == NoRouteResult) { ...base, state: NoRoute, reason: NoRouteFound }
  else if (quote.spent > remaining(p)) { ...base, reason: ExceedsRemaining }
  else if (quote.spent > maximumSafeValue) { ...base, reason: UnsafeValue }
  else if (quote.spent < 25000000) { ...base, state: Pending, reason: BelowMinimum }
  else if (quote.spent < quote.gasValue * 10) { ...base, state: Pending, reason: BelowGasMultiple }
  else if (quote.impactBps < 0) { ...base, reason: ImpactUnknown }
  else if (quote.impactBps > 300) { ...base, reason: ImpactAbove }
  else if (quote.slippageBps < 0 or quote.slippageBps > 100) { ...base, reason: SlippageOutside }
  else { ...base, state: Quoted }
pure def lastDecision(p: Pool, leg: PoolLeg): PoolDecision =
  p.decisions.foldl({ leg: leg, state: Quoted, reason: NoReason, value: -1, live: false, at: 0 }, (found, d) => if (d.leg == leg) d else found)
pure def note(d: PoolDecision, p: Pool): Pool =
  val previous = lastDecision(p, d.leg)
  if (previous.state == d.state and previous.reason == d.reason and previous.value == d.value and previous.live == d.live) p
  else { ...p, decisions: p.decisions.append(d) }
pure def canBeginRun(p: Pool): bool = R::runs(p.runtime) and p.runtime.buybackMode != R::Off
pure def beginRun(p: Pool): Pool = { ...p, runNumber: p.runNumber + 1, runSpent: 0 }
pure def canDecidePurchase(p: Pool, quote: PurchaseQuote): bool =
  p.runNumber > 0 and p.runtime.buybackMode != R::Off and not(B::openSend(p.purchase)) and quote.spent > 0 and quote.spent <= p.credit
    and quote.gasValue >= 0 and withinUsdgBalance(quote) and (purchaseDecision(p, quote).state != Quoted or p.runtime.buybackMode == R::DryRun)
pure def decidePurchase(p: Pool, quote: PurchaseQuote): Pool = note(purchaseDecision(p, quote), p)
pure def canPurchase(p: Pool, quote: PurchaseQuote): bool =
  signs(p) and p.runNumber > 0 and not(B::openSend(p.purchase)) and purchaseDecision(p, quote).state == Quoted
    and quote.tx > 0 and not(p.txs.includes(quote.tx)) and quote.spent <= p.credit
    and M::validAmount(quote.minimum) and M::positiveAmount(quote.minimum)
    and quote.receiver == "fees" and not(quote.tokenPaused) and withinUsdgBalance(quote)
pure def purchase(p: Pool, quote: PurchaseQuote): Pool =
  { ...p, credit: p.credit - quote.spent, runSpent: p.runSpent + quote.spent,
    purchase: { tx: quote.tx, phase: B::Submitted, amount: quote.spent }, purchaseMinimum: quote.minimum, txs: p.txs.append(quote.tx),
    purchaseSpends: p.purchaseSpends.append({ id: quote.tx, at: p.clock, amount: quote.spent, released: false }) }
pure def sometimesPurchasePending(p: Pool): bool = p.decisions.some(d => d.leg == PurchaseLeg and d.state == Pending)
pure def sometimesPurchaseDryQuoted(p: Pool): bool = p.decisions.some(d => d.leg == PurchaseLeg and d.state == Quoted)
pure def sometimesPurchaseCapSkipped(p: Pool): bool = p.decisions.some(d => d.leg == PurchaseLeg and d.state == Skipped)
```

### A purchase never spends more than the Robinhood fee wallet's finalized USDG balance

Each Robinhood Chain run reads the fee wallet's USDG balance at a finalized
block and quotes at most the least of the pool credit and that balance
(`B::boundedSend` with the remaining value cap), before the cap fitting that
may scale the input down further. Neither an evaluation nor a purchase ever
spends more than that balance, so an owner sweep of the wallet outside the
Worker only lowers the next purchase and leaves the credit for later runs.

```quint
pure def withinUsdgBalance(quote: PurchaseQuote): bool = quote.balance >= 0 and quote.spent <= quote.balance
pure def sometimesPurchaseBelowCredit(p: Pool): bool = B::openSend(p.purchase) and p.credit > 0
```

### Acquired SLOP is credited only from the finalized swap receipt

A lost response leaves the purchase unknown and its input spent. A finalized
success credits the exact SLOP output to the fee wallet. A finalized failure
returns its input to the pool and releases its rolling exposure; the run
total is not returned.

```quint
type SwapReceipt = { tx: int, succeeded: bool, finalized: bool, output: M::Amount, toFeeWallet: bool, slopToken: bool }
type SendReceipt = { tx: int, succeeded: bool, finalized: bool }
pure def canLoseSend(p: Pool, tx: int): bool =
  (p.purchase.tx == tx and p.purchase.phase == B::Submitted) or (p.burn.tx == tx and p.burn.phase == B::Submitted)
pure def loseSend(p: Pool, tx: int): Pool = { ...p, purchase: B::loseResponse(p.purchase, tx), burn: B::loseResponse(p.burn, tx) }
pure def canSettlePurchase(p: Pool, swap: SwapReceipt): bool =
  B::openSend(p.purchase) and swap.tx == p.purchase.tx and swap.finalized
    and (swap.succeeded implies M::validAmount(swap.output) and M::positiveAmount(swap.output) and swap.toFeeWallet and swap.slopToken)
pure def settlePurchase(p: Pool, swap: SwapReceipt): Pool =
  if (swap.succeeded) { ...p, purchase: { ...p.purchase, phase: B::Finalized }, purchased: M::addAmounts(p.purchased, swap.output) }
  else { ...p, purchase: { ...p.purchase, phase: B::Failed }, credit: p.credit + p.purchase.amount,
    purchaseSpends: B::release(p.purchaseSpends, p.purchase.tx) }
pure def sometimesPurchased(p: Pool): bool = M::positiveAmount(p.purchased)
pure def sometimesPurchaseFailed(p: Pool): bool = p.purchase.phase == B::Failed
```

## Story: Burn half of everything acquired, once

### Half of all acquired SLOP is burned, and a failed burn retries the same share

A fee received in SLOP on Robinhood Chain needs no purchase: its buyback
share counts as acquired. A burn sends exactly half of everything acquired,
rounded down, less every burn already committed, to the canonical dead
address. A paused token, a value below 5 USDG or below ten times the gas cost
waits as pending; a value beyond safe integer accounting is skipped; a dry
run records the burn as quoted. One burn is open at a time. A finalized burn
adds its exact quantity to the burned total; a failed burn releases its
commitment so the same share is burned again. Total supply is not modeled as
decreasing.

```quint
type BurnRequest = { tx: int, quantity: M::Amount, value: int, gasValue: int, destination: str, tokenPaused: bool }
pure def canReceiveSlopFee(p: Pool, fee: SlopFee): bool = fee.receipt > 0 and not(p.slopReceipts.includes(fee.receipt))
  and M::validAmount(fee.quantity) and M::positiveAmount(fee.quantity) and fee.chainTime >= B::buybackStart and fee.chainTime <= p.clock
pure def receiveSlopFee(p: Pool, fee: SlopFee): Pool =
  val total = M::addAmounts(p.localSlopIncome, fee.quantity)
  { ...p, localSlopIncome: total, localSlopCommitted: H::half(total).quotient, slopReceipts: p.slopReceipts.append(fee.receipt) }
pure def burnDue(p: Pool): M::Amount = M::subtractAmounts(H::half(acquired(p)).quotient, p.burnCommitted)
pure def burnDecision(p: Pool, request: BurnRequest): PoolDecision =
  val base = { leg: BurnLeg, state: Pending, reason: NoReason, value: request.value, live: p.runtime.buybackMode == R::Live, at: p.clock }
  if (request.tokenPaused) { ...base, reason: TokenPaused }
  else if (request.value < 5000000) { ...base, reason: BelowMinimum }
  else if (request.value < request.gasValue * 10) { ...base, reason: BelowGasMultiple }
  else if (request.value > maximumSafeValue) { ...base, state: Skipped, reason: UnsafeValue }
  else { ...base, state: Quoted }
pure def canDecideBurn(p: Pool, burnRequest: BurnRequest): bool =
  p.runNumber > 0 and p.runtime.buybackMode != R::Off and not(B::openSend(p.burn)) and burnRequest.value >= 0 and burnRequest.gasValue >= 0
    and M::validAmount(burnRequest.quantity) and M::positiveAmount(burnRequest.quantity)
    and M::compareAmounts(p.burnCommitted, H::half(acquired(p)).quotient) <= 0 and M::equalAmounts(burnRequest.quantity, burnDue(p))
    and (burnDecision(p, burnRequest).state != Quoted or p.runtime.buybackMode == R::DryRun)
pure def decideBurn(p: Pool, burnRequest: BurnRequest): Pool = note(burnDecision(p, burnRequest), p)
pure def canBurn(p: Pool, burnRequest: BurnRequest): bool =
  signs(p) and p.runNumber > 0 and not(B::openSend(p.burn)) and burnRequest.tx > 0 and not(p.txs.includes(burnRequest.tx))
    and M::validAmount(burnRequest.quantity) and M::positiveAmount(burnRequest.quantity)
    and M::compareAmounts(p.burnCommitted, H::half(acquired(p)).quotient) <= 0
    and M::equalAmounts(burnRequest.quantity, burnDue(p)) and burnDecision(p, burnRequest).state == Quoted
    and burnRequest.destination == B::deadAddress
pure def burn(p: Pool, burnRequest: BurnRequest): Pool =
  { ...p, burnCommitted: M::addAmounts(p.burnCommitted, burnRequest.quantity), burnQuantity: burnRequest.quantity,
    burn: { tx: burnRequest.tx, phase: B::Submitted, amount: 0 }, txs: p.txs.append(burnRequest.tx) }
pure def canSettleBurn(p: Pool, receipt: SendReceipt): bool =
  B::openSend(p.burn) and receipt.tx == p.burn.tx and receipt.finalized
pure def settleBurn(p: Pool, receipt: SendReceipt): Pool =
  val burnedTotal = M::addAmounts(p.burned, p.burnQuantity)
  if (receipt.succeeded) { ...p, burn: { ...p.burn, phase: B::Finalized }, burned: burnedTotal, burnCommitted: burnedTotal, burnQuantity: M::zero }
  else { ...p, burn: { ...p.burn, phase: B::Failed }, burnCommitted: p.burned, burnQuantity: M::zero }
pure def sometimesBurned(p: Pool): bool = p.burn.phase == B::Finalized and M::positiveAmount(p.burned)
pure def sometimesBurnRetried(p: Pool): bool = p.burn.phase == B::Failed and M::positiveAmount(acquired(p))
pure def sometimesBurnPending(p: Pool): bool = p.decisions.some(d => d.leg == BurnLeg and d.state == Pending)
```

## Story: Keep the pool's totals within their shares

### One run cap, one rolling cap and one burn share bound the whole pool

```quint
pure def alwaysPoolBounded(p: Pool): bool = p.credit >= 0 and p.runSpent >= 0 and p.runSpent <= runCap
  and B::spentInWindow(p.purchaseSpends, p.clock) <= dayCap
  and p.purchaseSpends.every(s => s.at >= B::buybackStart and s.at <= p.clock and s.amount > 0)
  and (B::openSend(p.purchase) implies p.purchase.amount >= 25000000) and p.clock >= B::buybackStart
pure def alwaysBurnBounded(p: Pool): bool = M::validAmount(p.burned) and M::validAmount(p.burnCommitted)
  and M::validAmount(p.purchased) and M::validAmount(p.burnQuantity)
  and M::validAmount(p.localSlopIncome) and M::validAmount(p.localSlopCommitted)
  and M::compareAmounts(p.localSlopCommitted, H::half(p.localSlopIncome).quotient) <= 0
  and M::compareAmounts(p.burnCommitted, H::half(acquired(p)).quotient) <= 0
  and (if (B::openSend(p.burn)) M::equalAmounts(p.burnCommitted, M::addAmounts(p.burned, p.burnQuantity))
    else p.burnCommitted == p.burned and p.burnQuantity == M::zero)
pure def alwaysDecisionsSignNothing(p: Pool): bool = p.decisions.every(d => d.at <= p.clock and (d.state == Quoted implies not(d.live)))
pure def stepTotalsMonotonic(before: Pool, after: Pool): bool = M::compareAmounts(after.purchased, before.purchased) >= 0
  and M::compareAmounts(after.burned, before.burned) >= 0 and M::compareAmounts(after.rhIncome, before.rhIncome) >= 0
  and M::compareAmounts(after.localSlopIncome, before.localSlopIncome) >= 0
pure def stepSignaturesNeedLiveBuyback(before: Pool, via: str, after: Pool): bool =
  (via == "purchase" or via == "burn") implies signs(before)
pure def stepRetained(before: Pool, after: Pool): bool = before.arrivals.every(a => after.arrivals.includes(a))
  and before.txs.every(t => after.txs.includes(t)) and before.decisions.every(d => after.decisions.includes(d))
  and before.rhReceipts.every(r => after.rhReceipts.includes(r)) and before.slopReceipts.every(r => after.slopReceipts.includes(r))
```

### Simulation samples exercise matching, refused and failed evidence

These sets bound simulation only.

```quint
pure val nowValues = Set(B::buybackStart + 1, B::buybackStart + 3600001, B::buybackStart + 86400001)
pure val arrivalValues = Set({ network: R::Base, order: 1, takeAmount: 495000000, height: 2 },
  { network: R::Solana, order: 1, takeAmount: 495000000, height: 2 }, { network: R::Robinhood, order: 2, takeAmount: 495000000, height: 2 })
pure val robinhoodFeeValues = Set({ receipt: 1, amount: 100000000, chainTime: B::buybackStart }, { receipt: 2, amount: 100000000, chainTime: B::buybackStart - 1 })
pure val amountValues = Set(25000000, 50000000)
pure val feeValues = Set({ receipt: 5, quantity: List(4), chainTime: B::buybackStart }, { receipt: 6, quantity: List(2), chainTime: B::buybackStart })
pure val variableValues = Set(true)
pure val byValues = Set(R::ReleaseWorkflow, R::Owner)
pure val configValues = Set(R::liveAll, { ...R::liveAll, source: 2, converterMode: R::DryRun, buybackMode: R::DryRun })
pure val quoteValues = Set(
  { route: RouteFound, tx: 24, spent: 25000000, minimum: List(5), gasValue: 1000, slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false, balance: 600000000 },
  { route: RouteFound, tx: 24, spent: 495000000, minimum: List(5), gasValue: 1000, slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false, balance: 600000000 },
  { route: RouteFound, tx: 24, spent: 25000000, minimum: List(5), gasValue: 5000000, slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false, balance: 600000000 },
  { route: RouteFound, tx: 24, spent: 25000000, minimum: List(5), gasValue: 1000, slippageBps: 101, impactBps: 300, receiver: "fees", tokenPaused: false, balance: 600000000 },
  { route: NoRouteResult, tx: 24, spent: 25000000, minimum: List(5), gasValue: 1000, slippageBps: 0, impactBps: 0, receiver: "fees", tokenPaused: false, balance: 600000000 },
  { route: RouteFound, tx: 24, spent: 25000000, minimum: List(5), gasValue: 1000, slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false, balance: 24999999 })
pure val swapValues = Set({ tx: 24, succeeded: true, finalized: true, output: List(6), toFeeWallet: true, slopToken: true },
  { tx: 24, succeeded: false, finalized: true, output: List(0), toFeeWallet: true, slopToken: true },
  { tx: 24, succeeded: true, finalized: true, output: List(6), toFeeWallet: false, slopToken: true })
pure val receiptValues = Set({ tx: 25, succeeded: true, finalized: true }, { tx: 25, succeeded: false, finalized: true })
pure val txValues = Set(24, 25)
pure val burnRequestValues = Set({ tx: 25, quantity: List(3), value: 5000000, gasValue: 1000, destination: B::deadAddress, tokenPaused: false },
  { tx: 25, quantity: List(1), value: 5000000, gasValue: 1000, destination: B::deadAddress, tokenPaused: false },
  { tx: 25, quantity: List(3), value: 5000000, gasValue: 1000, destination: B::deadAddress, tokenPaused: true },
  { tx: 25, quantity: List(3), value: 4000000, gasValue: 1000, destination: B::deadAddress, tokenPaused: false })
pure val weight_publishWorker = 4
pure val weight_verifyReadiness = 4
pure val weight_creditArrival = 5
pure val weight_beginRun = 5
pure val weight_purchase = 6
pure val weight_settlePurchase = 5
pure val weight_burn = 5
pure val weight_settleBurn = 5
```

# SLOP buyback and burn

PRD section 6 BUY-01 through BUY-07 and section 11 govern this flow. Source models include `buyback_accounting`, `buyback_bridge_order`, `buyback_market` and `buyback_slop_accounting`. The production activation instant is 12 November 2026 UTC. Staging remains off. An initial instance is unactivated to make activation authority explicit. Monetary inputs use integer base units, and USD valuation uses quote evidence supplied by the future adapter.

## Story: Commit each share of fee income once

### Only finalized income at or after activation increases the buyback budget

A token receipt counts only after conversion into USDC. The same receipt cannot count as both token income and conversion output. The income journal binds source and network outside this single-network machine.

```quint
import money as M from "../settlement/money"
type BridgeOrder = { orderId: int, amount: int, costBps: int, receiver: str, authority: str, beneficiary: str, externalCall: bool, affiliateFee: int, reservedTaker: str, now: int }
type PurchaseQuote = { spent: int, acquired: M::Amount, slippageBps: int, impactBps: int, receiver: str, tokenPaused: bool, now: int }
type BuybackPhase = Off | Ready | Ordered | InTransit | Arrived | Purchased | BurnPending | Burned | Refunded
 type Spend = { at: int, amount: int }
pure def spentInWindow(spends: List[Spend], now: int): int = spends.foldl(0, (total, spend) =>
  total + (if (spend.at > now - 86400000 and spend.at <= now) spend.amount else 0))
 type Buyback = { sourceIsRobinhood: bool, localSlopIncome: M::Amount, localSlopCommitted: M::Amount, clock: int, bridgeSpends: List[Spend], purchaseSpends: List[Spend], phase: BuybackPhase, income: M::Amount, committed: M::Amount, orderAmount: int,
  order: int, arrival: int, acquired: M::Amount, burnCommitted: M::Amount, burned: M::Amount,
  receipts: List[int], orders: List[int], finalizedHeight: int, outputWallet: str }
pure val initial: Buyback = { sourceIsRobinhood: false, localSlopIncome: M::zero, localSlopCommitted: M::zero, clock: 0, bridgeSpends: List(), purchaseSpends: List(), phase: Off, income: M::zero, committed: M::zero, orderAmount: 0, order: 0,
  arrival: 0, acquired: M::zero, burnCommitted: M::zero, burned: M::zero, receipts: List(), orders: List(),
  finalizedHeight: 0, outputWallet: "fees" }
pure val quantityValues = Set(List(1), List(2), List(3), List(0, 1))
pure val amountValues = Set(1, 500000000, 1000000000)
pure val incomeAmountValues = Set(List(1), List(0, 0, 500), List(0, 0, 0, 1), List(1, 0, 0, 1))
pure val receivedAtValues = Set(20261111, 20261112, 20261113)
pure def canActivate(b: Buyback, converterLive: bool, robinhoodEnabled: bool,
  explicitLimits: bool, by: str): bool = b.phase == Off and converterLive and robinhoodEnabled and explicitLimits and by == "owner"
pure def activate(b: Buyback, converterLive: bool, robinhoodEnabled: bool,
  explicitLimits: bool, by: str): Buyback = { ...b, phase: Ready }
pure def canRecordIncome(b: Buyback, receipt: int, incomeAmount: M::Amount, receivedAt: int, finalized: bool): bool =
  b.phase == Ready and receipt > 0 and not(b.receipts.includes(receipt)) and M::validAmount(incomeAmount) and M::positiveAmount(incomeAmount)
    and receivedAt >= 20261112 and finalized
pure def recordIncome(b: Buyback, receipt: int, incomeAmount: M::Amount, receivedAt: int, finalized: bool): Buyback =
  { ...b, income: M::addAmounts(b.income, incomeAmount), receipts: b.receipts.append(receipt) }
pure val byValues = Set("owner", "wrong")
pure val receiverValues = Set("fees", "wrong")
pure val beneficiaryValues = Set("fees", "wrong")
pure val destinationValues = Set("0x000000000000000000000000000000000000dEaD", "wrong")
```

### A bridge order commits only available share and exact approved destinations

Stablecoin inputs use integer micro-units. Cumulative income and committed share use arbitrary-length Amount limbs, so every verified base unit remains in the ledger. The available share is half the cumulative income rounded down to one micro-unit, less every previous commitment. The source wallet, receiver, order authority and refund beneficiary are the same reviewed fee-wallet identity across their network addresses. Every byte is checked before signing.

```quint
pure def canOrder(b: Buyback, orderRequest: BridgeOrder): bool =
  b.phase == Ready and not(b.sourceIsRobinhood) and orderRequest.orderId > 0 and not(b.orders.includes(orderRequest.orderId))
    and orderRequest.amount >= 500000000 and orderRequest.amount <= 1000000000
    and M::compareAmounts(M::addAmounts(b.committed, M::smallAmount(orderRequest.amount)), M::divideAmounts(b.income, List(2)).quotient) <= 0
    and orderRequest.costBps >= 0 and orderRequest.costBps <= 150
    and orderRequest.receiver == b.outputWallet and orderRequest.authority == b.outputWallet and orderRequest.beneficiary == b.outputWallet
    and not(orderRequest.externalCall) and orderRequest.affiliateFee == 0 and orderRequest.reservedTaker == ""
    and orderRequest.now >= b.clock and spentInWindow(b.bridgeSpends, orderRequest.now) + orderRequest.amount <= 5000000000
pure def order(b: Buyback, orderRequest: BridgeOrder): Buyback =
  { ...b, phase: Ordered, committed: M::addAmounts(b.committed, M::smallAmount(orderRequest.amount)), orderAmount: orderRequest.amount,
    order: orderRequest.orderId, orders: b.orders.append(orderRequest.orderId), clock: orderRequest.now,
    bridgeSpends: b.bridgeSpends.append({ at: orderRequest.now, amount: orderRequest.amount }) }
pure def canBroadcast(b: Buyback): bool = b.phase == Ordered
pure def broadcast(b: Buyback): Buyback = { ...b, phase: InTransit }
```

### An unfilled order stays in transit until fulfillment or refund is proven

The Worker has no cancellation action. Owner cancellation still needs finalized refund evidence to recover the budget. Fulfillment and refund are mutually exclusive terminal order outcomes.

```quint
pure def canObserveArrival(b: Buyback, order: int, amount: int, receiver: str, height: int, finalized: bool): bool =
  b.phase == InTransit and order == b.order and amount > 0 and receiver == b.outputWallet and height > 0 and finalized
pure def observeArrival(b: Buyback, order: int, amount: int, receiver: str, height: int, finalized: bool): Buyback =
  { ...b, phase: Arrived, arrival: amount, finalizedHeight: height }
pure def canObserveRefund(b: Buyback, order: int, amount: int, beneficiary: str, height: int, finalized: bool): bool =
  b.phase == InTransit and order == b.order and amount == b.orderAmount and beneficiary == b.outputWallet and height > 0 and finalized
pure def observeRefund(b: Buyback, order: int, amount: int, beneficiary: str, height: int, finalized: bool): Buyback =
  { ...b, phase: Refunded, committed: M::subtractAmounts(b.committed, M::smallAmount(b.orderAmount)), finalizedHeight: height }
```

### Each proven arrival is spent in full and half the acquired SLOP can burn once

SLOP token identity and the pinned swap route are checked by the receipt adapter. A paused token has no enabled purchase or burn. Burn transfers go only to the canonical dead address, and total supply is not modeled as decreasing.

```quint
pure def canPurchase(b: Buyback, purchaseRequest: PurchaseQuote): bool =
  b.phase == Arrived and purchaseRequest.spent == b.arrival and purchaseRequest.spent >= 25000000
    and M::validAmount(purchaseRequest.acquired) and M::positiveAmount(purchaseRequest.acquired)
    and purchaseRequest.slippageBps >= 0 and purchaseRequest.slippageBps <= 100
    and purchaseRequest.impactBps >= 0 and purchaseRequest.impactBps <= 300
    and purchaseRequest.receiver == b.outputWallet and not(purchaseRequest.tokenPaused)
    and purchaseRequest.spent <= 1000000000 and purchaseRequest.now >= b.clock
    and spentInWindow(b.purchaseSpends, purchaseRequest.now) + purchaseRequest.spent <= 5000000000
pure def purchase(b: Buyback, purchaseRequest: PurchaseQuote): Buyback =
  { ...b, phase: Purchased, acquired: M::addAmounts(b.acquired, purchaseRequest.acquired), clock: purchaseRequest.now,
    purchaseSpends: b.purchaseSpends.append({ at: purchaseRequest.now, amount: purchaseRequest.spent }) }
pure def canCommitBurn(b: Buyback, quantity: M::Amount, value: int, destination: str, tokenPaused: bool): bool =
  b.phase == Purchased and M::validAmount(quantity) and M::positiveAmount(quantity)
    and M::equalAmounts(quantity, M::subtractAmounts(M::divideAmounts(b.acquired, List(2)).quotient, b.burnCommitted))
    and value >= 5000000 and destination == "0x000000000000000000000000000000000000dEaD" and not(tokenPaused)
pure def commitBurn(b: Buyback, quantity: M::Amount, value: int, destination: str, tokenPaused: bool): Buyback =
  { ...b, phase: BurnPending, burnCommitted: M::addAmounts(b.burnCommitted, quantity) }
pure def canFinalizeBurn(b: Buyback, quantity: M::Amount, height: int, finalized: bool): bool =
  b.phase == BurnPending and M::equalAmounts(quantity, M::subtractAmounts(b.burnCommitted, b.burned)) and height > b.finalizedHeight and finalized
pure def finalizeBurn(b: Buyback, quantity: M::Amount, height: int, finalized: bool): Buyback =
  { ...b, phase: Burned, burned: M::addAmounts(b.burned, quantity), finalizedHeight: height }
pure def alwaysShareBounded(b: Buyback): bool = M::validAmount(b.income) and M::validAmount(b.committed) and M::compareAmounts(b.committed, M::divideAmounts(b.income, List(2)).quotient) <= 0
pure def alwaysBurnBounded(b: Buyback): bool = M::validAmount(b.burned) and M::compareAmounts(b.burned, b.burnCommitted) <= 0
  and M::validAmount(b.burnCommitted) and M::validAmount(b.acquired)
  and M::compareAmounts(b.burnCommitted, M::divideAmounts(b.acquired, List(2)).quotient) <= 0
pure def sometimesInTransit(b: Buyback): bool = b.phase == InTransit
pure def sometimesRefunded(b: Buyback): bool = b.phase == Refunded
pure def sometimesBurned(b: Buyback): bool = b.phase == Burned
```

## Story: Continue without counting income or burns twice

### A completed cycle preserves cumulative accounting and the journal

Rolling exposure uses integer UTC milliseconds and a 86,400,000-millisecond window. Timestamps come from the trusted clock. The retained journal includes approvals, fees and unresolved holds.

```quint
pure def canContinueCycle(b: Buyback): bool = b.phase == Purchased or b.phase == Burned or b.phase == Refunded
pure def continueCycle(b: Buyback): Buyback =
  { ...b, phase: Ready, orderAmount: 0, order: 0, arrival: 0 }
pure def alwaysWindowLimits(b: Buyback): bool = spentInWindow(b.bridgeSpends, b.clock) <= 5000000000
  and spentInWindow(b.purchaseSpends, b.clock) <= 5000000000
pure def alwaysJournalPastAndPositive(b: Buyback): bool = b.clock >= 0
  and b.bridgeSpends.every(spend => spend.at >= 0 and spend.at <= b.clock and spend.amount > 0)
  and b.purchaseSpends.every(spend => spend.at >= 0 and spend.at <= b.clock and spend.amount > 0)
pure def stepIncomeMonotonic(before: Buyback, after: Buyback): bool = M::compareAmounts(after.income, before.income) >= 0
  and M::compareAmounts(after.acquired, before.acquired) >= 0 and M::compareAmounts(after.burnCommitted, before.burnCommitted) >= 0
```

Discovered by the proof: cumulative acquired and burn-committed amounts must
retain valid limbs. The rolling-window bound also needs every journal entry
to have a positive amount and a timestamp no later than the observed clock.
Otherwise an arbitrary invariant-satisfying state can hide future spending
outside the current window and reveal it when the clock advances.

## Story: Check bridge-native and direct-receipt boundaries

### Bridge-native spending observes its own network ceilings

The Solana order allowance is independent of ordinary fee-conversion gas. EVM inputs use integer gwei and Solana inputs use lamports. The same signed transaction also remains subject to the shared native reservations and replacement policy.

```quint
pure def bridgeNativeAllowed(solana: bool, fixedFee: int, orderNative: int, dayNative: int): bool =
  if (solana) fixedFee >= 0 and orderNative >= 0 and orderNative <= 50000000
    and dayNative >= 0 and dayNative <= 100000000
  else fixedFee >= 0 and fixedFee <= 1000000 and orderNative >= fixedFee and dayNative >= orderNative
pure def localFeeShare(received: int, alreadyCommitted: int): int =
  if (received >= 0 and alreadyCommitted >= 0 and alreadyCommitted <= received / 2)
    received / 2 - alreadyCommitted else 0
pure def lawLocalShareBound(received: int, alreadyCommitted: int): bool =
  (received >= 0 and alreadyCommitted >= 0 and alreadyCommitted <= received / 2) implies
    localFeeShare(received, alreadyCommitted) + alreadyCommitted == received / 2
```

Robinhood fee claims enter the purchase leg directly after the same cumulative half-share check. A fee already received in SLOP contributes its cumulative half-share directly to acquired SLOP. The shared receipt journal prevents counting either receipt twice. Local and foreign instances retain distinct stablecoin asset identities at the adapter boundary.

```quint
pure def canSelectSource(b: Buyback, robinhood: bool): bool = b.phase == Off and b.receipts.length() == 0
pure def selectSource(b: Buyback, robinhood: bool): Buyback = { ...b, sourceIsRobinhood: robinhood }
pure def canReserveLocalShare(b: Buyback, amount: int): bool = b.phase == Ready and b.sourceIsRobinhood
  and amount >= 25000000 and amount <= 1000000000 and M::compareAmounts(M::addAmounts(b.committed, M::smallAmount(amount)), M::divideAmounts(b.income, List(2)).quotient) <= 0
pure def reserveLocalShare(b: Buyback, amount: int): Buyback =
  { ...b, phase: Arrived, committed: M::addAmounts(b.committed, M::smallAmount(amount)), arrival: amount }
pure def canReceiveSlopFee(b: Buyback, receipt: int, quantity: M::Amount, receivedAt: int, finalized: bool): bool = b.phase == Ready and b.sourceIsRobinhood
  and receipt > 0 and not(b.receipts.includes(receipt)) and M::validAmount(quantity) and M::positiveAmount(quantity) and receivedAt >= 20261112 and finalized
pure def receiveSlopFee(b: Buyback, receipt: int, quantity: M::Amount, receivedAt: int, finalized: bool): Buyback =
  val total = M::addAmounts(b.localSlopIncome, quantity)
  val half = M::divideAmounts(total, List(2)).quotient
  val share = M::subtractAmounts(half, b.localSlopCommitted)
  { ...b, phase: Purchased, localSlopIncome: total, localSlopCommitted: half,
    acquired: M::addAmounts(b.acquired, share), receipts: b.receipts.append(receipt) }
pure def alwaysLocalShareBounded(b: Buyback): bool = M::validAmount(b.localSlopIncome)
  and M::validAmount(b.localSlopCommitted) and M::compareAmounts(b.localSlopCommitted, M::divideAmounts(b.localSlopIncome, List(2)).quotient) <= 0
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val alreadyCommittedValues = Set(0, 1, 2)
pure val dayNativeValues = Set(0, 100000000, 100000001)
pure val fixedFeeValues = Set(0, 1000000, 1000001)
pure val heightValues = Set(0, 1, 2)
pure val nowValues = Set(0, 1, 86400000, 86400001)
pure val orderValues = Set(0, 1, 2)
pure val orderNativeValues = Set(0, 50000000, 50000001)
pure val receiptValues = Set(0, 1, 2)
pure val receivedValues = Set(0, 1, 2)
pure val valueValues = Set(4999999, 5000000)

pure val orderRequestValues = Set(
  { orderId: 1, amount: 500000000, costBps: 150, receiver: "fees", authority: "fees", beneficiary: "fees", externalCall: false, affiliateFee: 0, reservedTaker: "", now: 1 },
  { orderId: 2, amount: 500000000, costBps: 0, receiver: "fees", authority: "fees", beneficiary: "fees", externalCall: false, affiliateFee: 0, reservedTaker: "", now: 86400001 },
  { orderId: 1, amount: 500000000, costBps: 0, receiver: "wrong", authority: "fees", beneficiary: "fees", externalCall: false, affiliateFee: 0, reservedTaker: "", now: 1 },
  { orderId: 1, amount: 499999999, costBps: 0, receiver: "fees", authority: "fees", beneficiary: "fees", externalCall: false, affiliateFee: 0, reservedTaker: "", now: 1 },
  { orderId: 1, amount: 500000000, costBps: 151, receiver: "fees", authority: "fees", beneficiary: "fees", externalCall: false, affiliateFee: 0, reservedTaker: "", now: 1 },
  { orderId: 1, amount: 500000000, costBps: 0, receiver: "fees", authority: "fees", beneficiary: "fees", externalCall: true, affiliateFee: 1, reservedTaker: "unknown", now: 1 })
pure val purchaseRequestValues = Set(
  { spent: 500000000, acquired: List(6), slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false, now: 1 },
  { spent: 1000000000, acquired: List(6), slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: false, now: 86400001 },
  { spent: 500000000, acquired: List(6), slippageBps: 100, impactBps: 300, receiver: "wrong", tokenPaused: false, now: 1 },
  { spent: 500000000, acquired: List(6), slippageBps: 101, impactBps: 300, receiver: "fees", tokenPaused: false, now: 1 },
  { spent: 500000000, acquired: List(6), slippageBps: 100, impactBps: 301, receiver: "fees", tokenPaused: false, now: 1 },
  { spent: 500000000, acquired: List(6), slippageBps: 100, impactBps: 300, receiver: "fees", tokenPaused: true, now: 1 })
```

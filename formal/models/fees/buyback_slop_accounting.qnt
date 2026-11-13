// @source workers/fee-converter/verified-buyback.ts
// @source workers/fee-converter/buyback.ts
// @source workers/fee-converter/buyback-store.ts
// @source migrations/0121_fee_buyback.sql
// @evidence workers/fee-converter/buyback.test.ts
// @evidence workers/fee-converter/buyback.integration.ts
// Money accounting of the SLOP buyback on Robinhood Chain for one input
// asset (PRD section 6, "SLOP buyback and burn"). `credit` is what proven
// bridge arrivals delivered (buyback_accounting); `income` is fee income
// received on Robinhood in the same asset.
//
// An arrival is spent in full on SLOP; a fee received here at the share. All
// SLOP stays in the fee wallet, and the burn share of everything acquired,
// rounded down, is then sent to the burn address. The burn is taken of the
// cumulative total less every burn already committed, so the retained SLOP
// is never halved again. The owner may sweep any balance at any time.
//
// Bounds: arrivals and fees in steps of 1 or 2 units up to 4 units each,
// sweeps of one unit, one open purchase and one open burn, share and burn of
// 50%, one or two SLOP units per input unit. A second input asset adds an
// independent copy of the purchase ledger feeding the same `acquired` total.
module buyback_slop_accounting {
  type Send = { state: str, amount: int }
  type S = { credit: int, income: int, wallet: int, buyCommitted: int, buy: Send,
    acquired: int, slop: int, burnCommitted: int, burn: Send, dead: int,
    sweptInput: int, sweptSlop: int, spent: int }
  var s: S
  pure val Cap = 4
  pure val None = { state: "none", amount: 0 }
  pure def half(n: int): int = n / 2
  pure def least(a: int, b: int): int = if (a < b) a else b
  pure def open(send: Send): bool = Set("submitted", "unknown").contains(send.state)
  val buyDue = if (s.credit + half(s.income) > s.buyCommitted)
    s.credit + half(s.income) - s.buyCommitted else 0
  val burnOwed = if (half(s.acquired) > s.burnCommitted) half(s.acquired) - s.burnCommitted else 0
  val canBuy = not(open(s.buy)) and least(buyDue, s.wallet) > 0
  val canBurn = not(open(s.burn)) and least(burnOwed, s.slop) > 0

  action init = s' = { credit: 0, income: 0, wallet: 0, buyCommitted: 0, buy: None,
    acquired: 0, slop: 0, burnCommitted: 0, burn: None, dead: 0, sweptInput: 0, sweptSlop: 0,
    spent: 0 }
  // A proven bridge arrival, or a finalized fee claim on Robinhood.
  action arrive(n: int): bool = all { s.credit + n <= Cap,
    s' = s.with("credit", s.credit + n).with("wallet", s.wallet + n) }
  action earn(n: int): bool = all { s.income + n <= Cap,
    s' = s.with("income", s.income + n).with("wallet", s.wallet + n) }
  action sweepInput = all { s.wallet > 0,
    s' = s.with("wallet", s.wallet - 1).with("sweptInput", s.sweptInput + 1) }
  action sweepSlop = all { s.slop > 0,
    s' = s.with("slop", s.slop - 1).with("sweptSlop", s.sweptSlop + 1) }

  action signBuy = all { canBuy,
    s' = s.with("buy", { state: "submitted", amount: least(buyDue, s.wallet) })
      .with("buyCommitted", s.buyCommitted + least(buyDue, s.wallet)) }
  action loseBuyResponse = all { s.buy.state == "submitted",
    s' = s.with("buy", s.buy.with("state", "unknown")) }
  action buyFinalized(rate: int): bool = all { open(s.buy), s.wallet >= s.buy.amount,
    s' = s.with("buy", None).with("wallet", s.wallet - s.buy.amount)
      .with("spent", s.spent + s.buy.amount)
      .with("acquired", s.acquired + s.buy.amount * rate)
      .with("slop", s.slop + s.buy.amount * rate) }
  action buyFailed = all { open(s.buy),
    s' = s.with("buy", None).with("buyCommitted", s.buyCommitted - s.buy.amount) }

  action signBurn = all { canBurn,
    s' = s.with("burn", { state: "submitted", amount: least(burnOwed, s.slop) })
      .with("burnCommitted", s.burnCommitted + least(burnOwed, s.slop)) }
  action loseBurnResponse = all { s.burn.state == "submitted",
    s' = s.with("burn", s.burn.with("state", "unknown")) }
  action burnFinalized = all { open(s.burn), s.slop >= s.burn.amount,
    s' = s.with("burn", None).with("slop", s.slop - s.burn.amount)
      .with("dead", s.dead + s.burn.amount) }
  action burnFailed = all { open(s.burn),
    s' = s.with("burn", None).with("burnCommitted", s.burnCommitted - s.burn.amount) }

  action step = {
    nondet n = Set(1, 2).oneOf()
    any { arrive(n), earn(n), sweepInput, sweepSlop, signBuy, loseBuyResponse, buyFinalized(n),
      buyFailed, signBurn, loseBurnResponse, burnFinalized, burnFailed }
  }

  val invariant = all {
    // Purchases never commit or spend more than arrivals plus the share of fees.
    s.buyCommitted <= s.credit + half(s.income), s.spent <= s.buyCommitted,
    // The unconverted part of the fee is never spent by the Worker.
    s.wallet + s.sweptInput >= s.income - half(s.income),
    s.wallet + s.sweptInput + s.spent == s.credit + s.income,
    // The burn never commits or sends more than half of the acquired SLOP.
    s.burnCommitted <= half(s.acquired), s.dead <= s.burnCommitted,
    // Acquired SLOP is in the wallet, burned, or swept by the owner; never elsewhere.
    s.slop + s.dead + s.sweptSlop == s.acquired,
    // The retained share is at least the other half unless the owner swept it.
    s.slop + s.sweptSlop >= s.acquired - half(s.acquired),
    open(s.buy) implies s.buy.amount > 0 and s.buy.amount <= s.buyCommitted,
    open(s.burn) implies s.burn.amount > 0 and s.burn.amount <= s.burnCommitted,
    s.wallet >= 0, s.slop >= 0
  }

  run arrivalBuysInFullTest = init.then(arrive(2)).then(signBuy)
    .expect(s.buy.amount == 2 and invariant).then(buyFinalized(2))
    .expect(s.acquired == 4 and s.wallet == 0 and not(canBuy) and invariant)
  run robinhoodFeeBuysHalfTest = init.then(earn(2)).then(earn(2)).then(signBuy)
    .expect(s.buy.amount == 2 and invariant).then(buyFinalized(1))
    .expect(s.wallet == 2 and not(canBuy) and invariant)
  run arrivalAndFeeCombineTest = init.then(arrive(1)).then(earn(2)).then(signBuy)
    .expect(s.buy.amount == 2 and invariant)
  // The retained half is never halved again.
  run halfOfAcquiredBurnsOnceTest = init.then(arrive(2)).then(signBuy).then(buyFinalized(2))
    .then(signBurn).expect(s.burn.amount == 2 and invariant).then(burnFinalized)
    .expect(s.dead == 2 and s.slop == 2 and not(canBurn) and invariant)
  run laterPurchaseOwesOnlyItsHalfTest = init.then(arrive(1)).then(signBuy).then(buyFinalized(2))
    .then(signBurn).then(burnFinalized).then(arrive(1)).then(signBuy).then(buyFinalized(1))
    .expect(s.acquired == 3 and burnOwed == 0 and invariant).then(arrive(1)).then(signBuy)
    .then(buyFinalized(1)).then(signBurn).expect(s.burn.amount == 1 and invariant)
  run sweptSlopIsNotBurnedTest = init.then(arrive(1)).then(signBuy).then(buyFinalized(2))
    .then(sweepSlop).then(sweepSlop).expect(not(canBurn) and s.dead == 0 and invariant)
  run failedBurnRetriesSameShareTest = init.then(arrive(1)).then(signBuy).then(buyFinalized(2))
    .then(signBurn).then(loseBurnResponse).then(burnFailed).then(signBurn)
    .expect(s.burn.amount == 1 and invariant).then(burnFinalized)
    .expect(s.dead == 1 and not(canBurn) and invariant)
  run failedBuyReleasesAndRetriesTest = init.then(arrive(2)).then(signBuy).then(buyFailed)
    .expect(s.buyCommitted == 0 and invariant).then(signBuy).expect(s.buy.amount == 2 and invariant)
  run openBurnBlocksSecondBurnTest = init.then(arrive(2)).then(signBuy).then(buyFinalized(2))
    .then(signBurn).then(signBurn.fail())
}

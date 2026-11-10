// @source workers/fee-converter/verified-buyback.ts
// @source workers/fee-converter/buyback.ts
// @source workers/fee-converter/buyback-store.ts
// @source migrations/0121_fee_buyback.sql
// @evidence workers/fee-converter/buyback.test.ts
// Money accounting of the SLOP buyback across one source network (Base,
// Ethereum or Solana) and Robinhood Chain (PRD section 6, "SLOP buyback and
// burn").
//
// Source network: fees become USDC in the fee wallet (existing conversion).
// The buyback may bridge at most floor(income * share) of that USDC, where
// income is cumulative verified fee income since activation. Robinhood: the
// bridged arrival is spent in full on SLOP; a fee received on Robinhood is
// spent at the same share. Half of all SLOP acquired, rounded down, is sent
// to the burn address; the rest stays in the fee wallet.
//
// Every entitlement is "share of a cumulative total less what is already
// committed". A send is committed from the moment it is journaled until a
// verified failure or refund releases it, so a retry, a restart or a repeated
// run can never take the share twice. The owner may sweep any wallet balance
// at any time (an external transfer the Worker does not control); a sweep
// only lowers what the Worker can send.
//
// Bounds: income and fee steps of 1 or 2 units up to 6 units per side, one
// open send per leg, share and burn of 50%. A bridge delivers its deposit
// less a fee of at most one unit; a swap returns one or two SLOP units per
// input unit. The model is one asset per side; a second token on Robinhood
// adds an independent copy of the Robinhood ledger.
module buyback_accounting {
  type Send = { state: str, amount: int }
  type S = {
    // Source network.
    income: int, srcWallet: int, bridgeCommitted: int, bridge: Send,
    inTransit: int, deposited: int, refunded: int, bridgeFees: int,
    // Robinhood Chain.
    credit: int, rhIncome: int, rhWallet: int, buyCommitted: int, buy: Send,
    acquired: int, slopWallet: int, burnCommitted: int, burn: Send, dead: int,
    // What the owner removed with sweeps, per asset.
    sweptSrc: int, sweptRh: int, sweptSlop: int
  }
  var s: S
  pure val Cap = 6
  pure val None = { state: "none", amount: 0 }
  pure def half(n: int): int = n / 2
  pure def due(credit: int, income: int, committed: int): int = {
    val total = credit + half(income)
    if (total > committed) total - committed else 0
  }
  pure def least(a: int, b: int): int = if (a < b) a else b
  pure def open(send: Send): bool = Set("submitted", "unknown").contains(send.state)

  action init = s' = { income: 0, srcWallet: 0, bridgeCommitted: 0, bridge: None,
    inTransit: 0, deposited: 0, refunded: 0, bridgeFees: 0, credit: 0, rhIncome: 0,
    rhWallet: 0, buyCommitted: 0, buy: None, acquired: 0, slopWallet: 0,
    burnCommitted: 0, burn: None, dead: 0, sweptSrc: 0, sweptRh: 0, sweptSlop: 0 }

  // A finalized conversion or USDC fee claim on the source network.
  action earnSource(n: int): bool = all { s.income + n <= Cap,
    s' = s.with("income", s.income + n).with("srcWallet", s.srcWallet + n) }
  // A finalized fee claim on Robinhood Chain in the buy asset.
  action earnRobinhood(n: int): bool = all { s.rhIncome + n <= Cap,
    s' = s.with("rhIncome", s.rhIncome + n).with("rhWallet", s.rhWallet + n) }
  // Owner sweeps are outside the Worker and may take any balance.
  action sweepSource(n: int): bool = all { n <= s.srcWallet,
    s' = s.with("srcWallet", s.srcWallet - n).with("sweptSrc", s.sweptSrc + n) }
  action sweepRobinhood(n: int): bool = all { n <= s.rhWallet,
    s' = s.with("rhWallet", s.rhWallet - n).with("sweptRh", s.sweptRh + n) }
  action sweepSlop(n: int): bool = all { n <= s.slopWallet,
    s' = s.with("slopWallet", s.slopWallet - n).with("sweptSlop", s.sweptSlop + n) }

  // Bridge leg. The journal row commits the amount before broadcast.
  action signBridge = {
    val amount = least(due(0, s.income, s.bridgeCommitted), s.srcWallet)
    all { not(open(s.bridge)), amount > 0,
      s' = s.with("bridge", { state: "submitted", amount: amount })
        .with("bridgeCommitted", s.bridgeCommitted + amount) }
  }
  action loseBridgeResponse = all { s.bridge.state == "submitted",
    s' = s.with("bridge", s.bridge.with("state", "unknown")) }
  // A finalized deposit debits the wallet; funds are then in transit.
  action bridgeDeposited = all { open(s.bridge), s.srcWallet >= s.bridge.amount,
    s' = s.with("bridge", None).with("srcWallet", s.srcWallet - s.bridge.amount)
      .with("inTransit", s.inTransit + s.bridge.amount)
      .with("deposited", s.deposited + s.bridge.amount) }
  // A reverted or provably expired deposit moved nothing and releases its share.
  action bridgeFailed = all { open(s.bridge),
    s' = s.with("bridge", None).with("bridgeCommitted", s.bridgeCommitted - s.bridge.amount) }
  // A verified arrival credits Robinhood once, less the bridge fee.
  action arrive(fee: int): bool = all { s.inTransit > 0, fee < s.inTransit,
    s' = s.with("inTransit", 0).with("credit", s.credit + s.inTransit - fee)
      .with("rhWallet", s.rhWallet + s.inTransit - fee)
      .with("bridgeFees", s.bridgeFees + fee) }
  // A verified refund returns the deposit to the source wallet and releases its share.
  action refund = all { s.inTransit > 0,
    s' = s.with("inTransit", 0).with("srcWallet", s.srcWallet + s.inTransit)
      .with("refunded", s.refunded + s.inTransit)
      .with("bridgeCommitted", s.bridgeCommitted - s.inTransit) }

  // Buy leg on Robinhood Chain.
  action signBuy = {
    val amount = least(due(s.credit, s.rhIncome, s.buyCommitted), s.rhWallet)
    all { not(open(s.buy)), amount > 0,
      s' = s.with("buy", { state: "submitted", amount: amount })
        .with("buyCommitted", s.buyCommitted + amount) }
  }
  action loseBuyResponse = all { s.buy.state == "submitted",
    s' = s.with("buy", s.buy.with("state", "unknown")) }
  action buyFinalized(rate: int): bool = all { open(s.buy), s.rhWallet >= s.buy.amount,
    s' = s.with("buy", None).with("rhWallet", s.rhWallet - s.buy.amount)
      .with("acquired", s.acquired + s.buy.amount * rate)
      .with("slopWallet", s.slopWallet + s.buy.amount * rate) }
  action buyFailed = all { open(s.buy),
    s' = s.with("buy", None).with("buyCommitted", s.buyCommitted - s.buy.amount) }

  // Burn leg: half of everything acquired, less every burn already committed.
  action signBurn = {
    val owed = half(s.acquired) - s.burnCommitted
    val amount = least(if (owed > 0) owed else 0, s.slopWallet)
    all { not(open(s.burn)), amount > 0,
      s' = s.with("burn", { state: "submitted", amount: amount })
        .with("burnCommitted", s.burnCommitted + amount) }
  }
  action loseBurnResponse = all { s.burn.state == "submitted",
    s' = s.with("burn", s.burn.with("state", "unknown")) }
  action burnFinalized = all { open(s.burn), s.slopWallet >= s.burn.amount,
    s' = s.with("burn", None).with("slopWallet", s.slopWallet - s.burn.amount)
      .with("dead", s.dead + s.burn.amount) }
  action burnFailed = all { open(s.burn),
    s' = s.with("burn", None).with("burnCommitted", s.burnCommitted - s.burn.amount) }

  action step = {
    nondet n = Set(1, 2).oneOf()
    nondet fee = Set(0, 1).oneOf()
    any { earnSource(n), earnRobinhood(n), sweepSource(n), sweepRobinhood(n), sweepSlop(n),
      signBridge, loseBridgeResponse, bridgeDeposited, bridgeFailed, arrive(fee), refund,
      signBuy, loseBuyResponse, buyFinalized(n), buyFailed,
      signBurn, loseBurnResponse, burnFinalized, burnFailed }
  }

  val invariant = all {
    // The bridge never commits more than the share of source income.
    s.bridgeCommitted <= half(s.income),
    s.deposited - s.refunded <= half(s.income),
    // The owner's part of source income is never bridged.
    s.srcWallet + s.sweptSrc + s.inTransit + s.credit + s.bridgeFees == s.income,
    s.srcWallet + s.sweptSrc >= s.income - half(s.income) - (if (open(s.bridge)) 0 else 0),
    // The buy never commits more than arrivals plus the share of Robinhood fees.
    s.buyCommitted <= s.credit + half(s.rhIncome),
    // A bridged arrival is credited once and never exceeds what was deposited.
    s.credit + s.bridgeFees + s.inTransit + s.refunded == s.deposited,
    // The burn never commits or sends more than half of the acquired SLOP.
    s.burnCommitted <= half(s.acquired), s.dead <= s.burnCommitted,
    // Acquired SLOP is in the wallet, burned, or swept by the owner; never elsewhere.
    s.slopWallet + s.dead + s.sweptSlop == s.acquired,
    // Committed totals cover every open send.
    open(s.bridge) implies s.bridge.amount > 0 and s.bridge.amount <= s.bridgeCommitted,
    open(s.buy) implies s.buy.amount > 0 and s.buy.amount <= s.buyCommitted,
    open(s.burn) implies s.burn.amount > 0 and s.burn.amount <= s.burnCommitted,
    s.srcWallet >= 0, s.rhWallet >= 0, s.slopWallet >= 0, s.inTransit >= 0
  }

  // Scenarios.
  run halfOfSourceFeesBridgesTest = init.then(earnSource(2)).then(earnSource(2)).then(signBridge)
    .expect(s.bridge.amount == 2 and invariant).then(bridgeDeposited).then(signBridge.fail())
    .then(arrive(0)).expect(s.credit == 2 and s.srcWallet == 2 and invariant)
  run oddIncomeRoundsDownTest = init.then(earnSource(1)).then(signBridge.fail())
    .then(earnSource(2)).then(signBridge).expect(s.bridge.amount == 1 and invariant)
  run arrivalBuysInFullTest = init.then(earnSource(2)).then(earnSource(2)).then(signBridge)
    .then(bridgeDeposited).then(arrive(0)).then(signBuy).expect(s.buy.amount == 2 and invariant)
    .then(buyFinalized(2)).expect(s.acquired == 4 and s.rhWallet == 0 and invariant)
  run robinhoodFeeBuysHalfTest = init.then(earnRobinhood(2)).then(earnRobinhood(2)).then(signBuy)
    .expect(s.buy.amount == 2 and invariant).then(buyFinalized(1)).then(signBuy.fail())
    .expect(s.rhWallet == 2 and invariant)
  run halfOfAcquiredBurnsOnceTest = init.then(earnRobinhood(2)).then(earnRobinhood(2)).then(signBuy)
    .then(buyFinalized(2)).then(signBurn).expect(s.burn.amount == 2 and invariant)
    .then(burnFinalized).expect(s.dead == 2 and s.slopWallet == 2 and invariant)
    // The retained half is never halved again.
    .then(signBurn.fail())
  run failedBridgeReleasesShareTest = init.then(earnSource(2)).then(signBridge).then(loseBridgeResponse)
    .then(signBridge.fail()).then(bridgeFailed).expect(s.bridgeCommitted == 0 and invariant)
    .then(signBridge).expect(s.bridge.amount == 1 and invariant)
  run refundReturnsAndReleasesTest = init.then(earnSource(2)).then(earnSource(2)).then(signBridge)
    .then(bridgeDeposited).then(refund).expect(s.srcWallet == 4 and s.bridgeCommitted == 0 and invariant)
    .then(signBridge).expect(s.bridge.amount == 2 and invariant)
  run sweepOnlyLowersSendTest = init.then(earnSource(2)).then(earnSource(2)).then(sweepSource(2))
    .then(sweepSource(1)).then(signBridge).expect(s.bridge.amount == 1 and invariant)
  run sweptSlopIsNotBurnedTest = init.then(earnRobinhood(2)).then(signBuy).then(buyFinalized(2))
    .then(sweepSlop(2)).then(signBurn.fail()).expect(s.dead == 0 and invariant)
  run failedBurnRetriesSameShareTest = init.then(earnRobinhood(2)).then(signBuy).then(buyFinalized(2))
    .then(signBurn).then(burnFailed).then(signBurn).expect(s.burn.amount == 1 and invariant)
    .then(burnFinalized).then(signBurn.fail()).expect(s.dead == 1 and invariant)
  run bridgeFeeNeverCountsAsCreditTest = init.then(earnSource(2)).then(earnSource(2)).then(signBridge)
    .then(bridgeDeposited).then(arrive(1)).expect(s.credit == 1 and s.bridgeFees == 1 and invariant)
}

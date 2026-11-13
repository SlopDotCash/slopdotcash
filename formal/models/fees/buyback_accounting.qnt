// @source workers/fee-converter/verified-buyback.ts
// @source workers/fee-converter/buyback.ts
// @source workers/fee-converter/buyback-store.ts
// @source migrations/0121_fee_buyback.sql
// @evidence workers/fee-converter/buyback.test.ts
// @evidence workers/fee-converter/buyback.integration.ts
// Money accounting of the SLOP buyback on one source network (Base, Ethereum
// or Solana), up to the credit its bridge orders create on Robinhood Chain
// (PRD section 6, "SLOP buyback and burn"). The Robinhood side, from that
// credit to the burn, is buyback_slop_accounting.
//
// Fees become USDC in the fee wallet (existing conversion). The buyback may
// bridge at most floor(income * share) of that USDC, where income is the
// cumulative verified fee income since activation. The entitlement is "share
// of the cumulative total less what is already committed". A send is
// committed from the moment it is journaled until a verified failure or
// refund releases it, so a retry, a restart or a repeated run can never take
// the share twice. The owner may sweep any wallet balance at any time (an
// external transfer the Worker does not control); a sweep only lowers what
// the Worker can send.
//
// Bounds: income steps of 1 or 2 units up to 6 units, sweeps of one unit, one
// open order, a share of 50%, a bridge fee of at most one unit per deposit.
// Refunded deposits total at most 6 units, which bounds the otherwise endless
// deposit-and-refund cycle. Odd and even totals, partial sweeps, repeated
// refunds and retries are within these bounds.
module buyback_accounting {
  type Send = { state: str, amount: int }
  type S = { income: int, wallet: int, committed: int, bridge: Send, inTransit: int,
    deposited: int, refunded: int, bridgeFees: int, credit: int, swept: int }
  var s: S
  pure val Cap = 6
  pure val None = { state: "none", amount: 0 }
  pure def half(n: int): int = n / 2
  pure def least(a: int, b: int): int = if (a < b) a else b
  pure def open(send: Send): bool = Set("submitted", "unknown").contains(send.state)
  val due = if (half(s.income) > s.committed) half(s.income) - s.committed else 0
  val canBridge = not(open(s.bridge)) and s.inTransit == 0 and least(due, s.wallet) > 0

  action init = s' = { income: 0, wallet: 0, committed: 0, bridge: None, inTransit: 0,
    deposited: 0, refunded: 0, bridgeFees: 0, credit: 0, swept: 0 }
  // A finalized conversion or USDC fee claim.
  action earn(n: int): bool = all { s.income + n <= Cap,
    s' = s.with("income", s.income + n).with("wallet", s.wallet + n) }
  // Owner sweeps are outside the Worker and may take any balance.
  action sweep = all { s.wallet > 0,
    s' = s.with("wallet", s.wallet - 1).with("swept", s.swept + 1) }
  // The journal row commits the amount before broadcast.
  action signBridge = all { canBridge,
    s' = s.with("bridge", { state: "submitted", amount: least(due, s.wallet) })
      .with("committed", s.committed + least(due, s.wallet)) }
  action loseResponse = all { s.bridge.state == "submitted",
    s' = s.with("bridge", s.bridge.with("state", "unknown")) }
  // A finalized deposit debits the wallet; funds are then in transit.
  action deposit = all { open(s.bridge), s.wallet >= s.bridge.amount,
    s' = s.with("bridge", None).with("wallet", s.wallet - s.bridge.amount)
      .with("inTransit", s.inTransit + s.bridge.amount)
      .with("deposited", s.deposited + s.bridge.amount) }
  // A reverted or provably expired order moved nothing and releases its share.
  action orderFailed = all { open(s.bridge),
    s' = s.with("bridge", None).with("committed", s.committed - s.bridge.amount) }
  // A verified arrival credits Robinhood once, less the bridge fee.
  action arrive(fee: int): bool = all { s.inTransit > 0, fee < s.inTransit,
    s' = s.with("inTransit", 0).with("credit", s.credit + s.inTransit - fee)
      .with("bridgeFees", s.bridgeFees + fee) }
  // A verified refund returns the deposit and releases its share.
  action refund = all { s.inTransit > 0, s.refunded + s.inTransit <= Cap,
    s' = s.with("inTransit", 0).with("wallet", s.wallet + s.inTransit)
      .with("refunded", s.refunded + s.inTransit).with("committed", s.committed - s.inTransit) }

  action step = {
    nondet n = Set(1, 2).oneOf()
    nondet fee = Set(0, 1).oneOf()
    any { earn(n), sweep, signBridge, loseResponse, deposit, orderFailed, arrive(fee), refund }
  }

  val invariant = all {
    // The bridge never commits or deposits more than the share of income.
    s.committed <= half(s.income), s.deposited - s.refunded <= half(s.income),
    // Every unit of income is in the wallet, swept, in transit, credited or a bridge fee.
    s.wallet + s.swept + s.inTransit + s.credit + s.bridgeFees == s.income,
    // What stays for the owner is at least the other half of income.
    s.wallet + s.swept >= s.income - half(s.income),
    // An arrival is credited once and never exceeds what was deposited.
    s.credit + s.bridgeFees + s.inTransit + s.refunded == s.deposited,
    // One DLN order at a time includes a finalized deposit awaiting its outcome.
    s.inTransit > 0 implies not(open(s.bridge)),
    open(s.bridge) implies s.bridge.amount > 0 and s.bridge.amount <= s.committed,
    s.wallet >= 0, s.inTransit >= 0, s.committed >= 0
  }

  run halfOfFeesBridgesTest = init.then(earn(2)).then(earn(2)).then(signBridge)
    .expect(s.bridge.amount == 2 and invariant).then(deposit).expect(not(canBridge))
    .then(arrive(0)).expect(s.credit == 2 and s.wallet == 2 and not(canBridge) and invariant)
  run oddIncomeRoundsDownTest = init.then(earn(1)).expect(not(canBridge))
    .then(earn(2)).then(signBridge).expect(s.bridge.amount == 1 and invariant)
  run laterFeesOweOnlyTheirHalfTest = init.then(earn(2)).then(signBridge).then(deposit).then(arrive(0))
    .then(earn(1)).expect(not(canBridge)).then(earn(1)).then(signBridge)
    .expect(s.bridge.amount == 1 and s.committed == 2 and invariant)
  run failedBridgeReleasesShareTest = init.then(earn(2)).then(signBridge).then(loseResponse)
    .expect(not(canBridge)).then(orderFailed).expect(s.committed == 0 and invariant)
    .then(signBridge).expect(s.bridge.amount == 1 and invariant)
  run refundReturnsAndReleasesTest = init.then(earn(2)).then(earn(2)).then(signBridge)
    .then(deposit).then(refund).expect(s.wallet == 4 and s.committed == 0 and invariant)
    .then(signBridge).expect(s.bridge.amount == 2 and invariant)
  run sweepOnlyLowersSendTest = init.then(earn(2)).then(earn(2)).then(sweep).then(sweep).then(sweep)
    .then(signBridge).expect(s.bridge.amount == 1 and invariant)
  run bridgeFeeNeverCountsAsCreditTest = init.then(earn(2)).then(earn(2)).then(signBridge)
    .then(deposit).then(arrive(1)).expect(s.credit == 1 and s.bridgeFees == 1 and invariant)
  run openBridgeBlocksSecondOrderTest = init.then(earn(2)).then(earn(2)).then(signBridge)
    .then(signBridge.fail())
  run newIncomeWaitsForFinalizedOrderOutcomeTest = init.then(earn(2)).then(signBridge)
    .then(deposit).then(earn(2)).expect(due == 1 and not(canBridge) and invariant)
    .then(signBridge.fail())
  run newIncomeResumesAfterArrivalTest = init.then(earn(2)).then(signBridge)
    .then(deposit).then(earn(2)).then(arrive(0)).then(signBridge)
    .expect(s.bridge.amount == 1 and s.committed == 2 and invariant)
}

// @source workers/fee-converter/buyback.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/buyback-config.ts
// @source workers/fee-converter/config.ts
// @source workers/fee-converter/verified-buyback.ts
// @source workers/fee-converter/wrangler.toml
// @source workers/fee-converter/wrangler.staging.toml
// @evidence workers/fee-converter/buyback.test.ts
// @evidence workers/fee-converter/evm-buyback-eligibility.test.ts
// PRD section 6, BUY-01..05: the owner-approved $25 quote threshold is applied
// to unspent entitlement, not the wallet's total balance. Bridge cost means
// token shortfall plus priced native cost, with a 10% limit after quoting.
//
// Bounds: one asset/leg per trace (bridge USDC, local reference USDG, or other
// local asset); one fee receipt of 8, 9, 10 or 12 units, one pending receipt of
// 10, one unrelated top-up of 10, one proven arrival of 5, and two quotes.
// One value unit is $5; threshold 5 is $25. Half-income rounding is in these
// abstract units, not a proof of integer token-base-unit refinement. Bridge
// costs use tenths of a value unit, so cost <= quoted value means <= 10%.
// Remaining value caps start at 12 units and only decrease within this run.
// Wallets are at most 27 units; sweeps, commitments and refunds conserve them.
//
// Unknown assets must be valued before requesting a SLOP route. Their raw
// token units are not dollar values; valuation results are 0, 4, 5, 6 or 7.
// Above-cap valuation/rescaling, native ceilings, slippage, price impact,
// signing, leases, and chain/journal authenticity are separate model families
// and implementation checks. recordFinalizedCommit abstracts a previously
// checked send plus its finalized debit, not permission or proof of payment.
// A refund releases entitlement but does not erase rolling-day value usage.
// One historical owed burn is assumed to meet its own value/gas/token limits.
// No fairness, real-money execution, provider availability or clean scan is
// established by this finite model. Recovery does not require a new quote.
module buyback_quote_eligibility {
  type S = {
    asset: str, income: int, pending: int, topup: int, credit: int,
    wallet: int, swept: int, committed: int, cap: int, stage: str,
    valuationAmount: int, valuation: int, valued: bool,
    quoteAmount: int, quoteValue: int, quotes: int,
    reconciled: bool, burnOwed: bool, burned: bool,
    quotedBad: bool, acceptedBadCost: bool
  }
  var s: S
  pure val Minimum = 5
  pure def least(a: int, b: int): int = if (a < b) a else b
  val due = s.credit + s.income / 2 - s.committed
  val held = least(due, s.wallet)
  val candidate = if (s.asset == "other") held else least(held, s.cap)
  val candidateValue = if (s.asset == "other") s.valuation else candidate
  val known = s.asset != "other" or (s.valued and s.valuationAmount == candidate)
  val canQuote = all {
    s.stage == "idle", s.quotes < 2, due > 0, candidate > 0,
    s.cap >= Minimum, known, candidateValue >= Minimum
  }

  action init = s' = {
    asset: "bridge", income: 0, pending: 0, topup: 0, credit: 0,
    wallet: 0, swept: 0, committed: 0, cap: 12, stage: "idle",
    valuationAmount: 0, valuation: 0, valued: false,
    quoteAmount: 0, quoteValue: 0, quotes: 0,
    reconciled: false, burnOwed: true, burned: false,
    quotedBad: false, acceptedBadCost: false
  }
  action chooseAsset(asset: str): bool = all {
    s.income == 0, s.pending == 0, s.credit == 0, s.quotes == 0,
    s.stage == "idle", s' = s.with("asset", asset).with("valued", false)
  }
  action finalizedFee(n: int): bool = all {
    s.income == 0, s.pending == 0,
    s' = s.with("income", n).with("wallet", s.wallet + n)
  }
  // A balance observation may see the pending receipt; fee evidence cannot.
  action pendingFee = all {
    s.income == 0, s.pending == 0,
    s' = s.with("pending", 10).with("wallet", s.wallet + 10)
  }
  action finalizePending = all {
    s.pending == 10, s.income == 0,
    s' = s.with("pending", 0).with("income", 10)
  }
  action ownerTopup = all {
    s.topup == 0, s' = s.with("topup", 10).with("wallet", s.wallet + 10)
  }
  // An arrival is already buyback money; it is not halved a second time.
  action provenArrival = all {
    s.asset == "reference", s.credit == 0,
    s' = s.with("credit", 5).with("wallet", s.wallet + 5)
  }
  action sweep(n: int): bool = all {
    s.wallet >= n, s' = s.with("wallet", s.wallet - n).with("swept", s.swept + n)
  }
  action consumeCap(n: int): bool = all {
    s.cap >= n, s' = s.with("cap", s.cap - n)
  }
  action requestValuation = all {
    s.asset == "other", s.stage == "idle", candidate > 0,
    s.cap >= Minimum, s.quotes < 2,
    s' = s.with("stage", "valuing").with("valued", false)
      .with("valuationAmount", candidate)
  }
  action valuationReply(value: int): bool = all {
    s.stage == "valuing", s' = s.with("stage", "idle")
      .with("valuation", value).with("valued", true)
  }
  action valuationUnavailable = all {
    s.stage == "valuing", s' = s.with("stage", "idle").with("valued", false)
  }
  action requestQuote = all {
    canQuote,
    s' = s.with("stage", "quoted").with("quoteAmount", candidate)
      .with("quoteValue", candidateValue).with("quotes", s.quotes + 1)
      // Latch the facts at the request: a later refund/top-up cannot hide it.
      .with("quotedBad", s.quotedBad or not(known) or candidateValue < Minimum
        or candidate > due or candidate > s.wallet or s.cap < Minimum
        or (s.asset != "other" and candidate > s.cap))
  }
  action acceptBridgeQuote(costTenths: int): bool = all {
    s.asset == "bridge", s.stage == "quoted", costTenths <= s.quoteValue,
    s' = s.with("stage", "checked")
      .with("acceptedBadCost", s.acceptedBadCost or costTenths > s.quoteValue)
  }
  action acceptPurchaseQuote = all {
    s.asset != "bridge", s.stage == "quoted", s.quoteValue <= s.cap,
    s' = s.with("stage", "checked")
  }
  action discardQuote = all {
    s.stage == "quoted", s' = s.with("stage", "idle")
  }
  action recordFinalizedCommit = all {
    s.stage == "checked", s.quoteAmount <= due, s.quoteAmount <= s.wallet,
    s.quoteValue <= s.cap,
    s' = s.with("stage", "inTransit").with("wallet", s.wallet - s.quoteAmount)
      .with("committed", s.committed + s.quoteAmount).with("cap", s.cap - s.quoteValue)
  }
  action reconcileExisting = all {
    s.stage == "inTransit", s' = s.with("reconciled", true)
  }
  action provenRefund = all {
    s.asset == "bridge", s.stage == "inTransit",
    s' = s.with("stage", "idle").with("wallet", s.wallet + s.quoteAmount)
      .with("committed", s.committed - s.quoteAmount)
  }
  action provenOutcome = all {
    s.stage == "inTransit", s' = s.with("stage", "idle")
  }
  action settleOwedBurn = all {
    s.burnOwed, s' = s.with("burnOwed", false).with("burned", true)
  }

  // Keep parameter choices within their branch; unused choices do not create
  // a Cartesian product. This retains the same concrete successor relation.
  action step = any {
    { nondet asset = Set("bridge", "reference", "other").oneOf() chooseAsset(asset) },
    { nondet income = Set(8, 9, 10, 12).oneOf() finalizedFee(income) },
    { nondet n = Set(1, 4, 7, 10).oneOf() sweep(n) },
    { nondet n = Set(1, 4, 7, 10).oneOf() consumeCap(n) },
    { nondet value = Set(0, 4, 5, 6, 7).oneOf() valuationReply(value) },
    { nondet cost = Set(0, 5, 6, 7).oneOf() acceptBridgeQuote(cost) },
    pendingFee, finalizePending, ownerTopup, provenArrival, requestValuation,
    valuationUnavailable, requestQuote, acceptPurchaseQuote, discardQuote,
    recordFinalizedCommit, reconcileExisting, provenRefund, provenOutcome, settleOwedBurn
  }
  val invariant = all {
    not(s.quotedBad), not(s.acceptedBadCost),
    s.committed >= 0, due >= 0, s.wallet >= 0, s.cap >= 0,
    s.wallet + s.swept + s.committed == s.income + s.pending + s.topup + s.credit,
    s.wallet <= 27, s.cap <= 12, s.quotes <= 2,
    s.stage == "inTransit" implies s.committed >= s.quoteAmount,
    s.income == 0 and s.credit == 0 implies not(canQuote)
  }

  run belowHalfEntitlementDoesNotQuoteTest = init.then(finalizedFee(9))
    .expect(s.wallet >= Minimum and due < Minimum and invariant).then(requestQuote.fail())
  run exactlyThresholdQuotesTest = init.then(finalizedFee(10)).then(requestQuote)
    .expect(s.quoteAmount == Minimum and s.quoteValue == Minimum and invariant)
  run ownerTopupIsNotFeeIncomeTest = init.then(ownerTopup)
    .expect(s.wallet >= Minimum and due == 0 and invariant).then(requestQuote.fail())
  run unfinalizedFeeWaitsForEvidenceTest = init.then(pendingFee).expect(not(canQuote) and invariant)
    .then(finalizePending).then(requestQuote).expect(s.quoteValue == Minimum and invariant)
  run sweepBoundsActualAvailableFundsTest = init.then(finalizedFee(10)).then(sweep(4))
    .then(sweep(4)).expect(due == Minimum and candidate == 2 and invariant).then(requestQuote.fail())
  run remainingCapStopsNewQuoteTest = init.then(finalizedFee(12)).then(consumeCap(10))
    .expect(due >= Minimum and invariant).then(requestQuote.fail())
  run priorCommitmentLeavesOnlyRemainderTest = init.then(finalizedFee(12)).then(consumeCap(7))
    .then(requestQuote).then(acceptBridgeQuote(5)).then(recordFinalizedCommit).then(provenOutcome)
    .expect(due == 1 and s.wallet >= Minimum and invariant).then(requestQuote.fail())
  run refundRestoresEntitlementWithoutErasingCapUsageTest = init.then(finalizedFee(10))
    .then(requestQuote).then(acceptBridgeQuote(5)).then(recordFinalizedCommit)
    .expect(due == 0 and not(canQuote) and invariant).then(reconcileExisting)
    .then(provenRefund).expect(due == Minimum and s.cap == 7 and s.reconciled and invariant)
    .then(requestQuote).expect(s.quotes == 2 and invariant)
  run tenPercentAllInBridgeCostAcceptedTest = init.then(finalizedFee(10))
    .then(requestQuote).then(acceptBridgeQuote(5)).expect(s.stage == "checked" and invariant)
  run aboveTenPercentCostRefusedTest = init.then(finalizedFee(10))
    .then(requestQuote).expect(invariant).then(acceptBridgeQuote(6).fail())
  run referenceArrivalIsNotHalvedAgainTest = init.then(chooseAsset("reference"))
    .then(provenArrival).then(requestQuote).expect(s.quoteValue == Minimum and invariant)
  run tokenUnitsNeedValuationTest = init.then(chooseAsset("other")).then(finalizedFee(12))
    .expect(not(canQuote)).then(requestValuation).then(valuationReply(4))
    .expect(s.quotes == 0 and invariant).then(requestQuote.fail())
  run valuedOtherAssetCanRequestSlopRouteTest = init.then(chooseAsset("other"))
    .then(finalizedFee(10)).then(requestValuation).then(valuationReply(5))
    .then(requestQuote).expect(s.quoteValue == Minimum and invariant)
  run unavailableValuationDoesNotRequestSlopTest = init.then(chooseAsset("other"))
    .then(finalizedFee(10)).then(requestValuation).then(valuationUnavailable)
    .expect(s.quotes == 0 and invariant).then(requestQuote.fail())
  run owedBurnRemainsPossibleBelowQuoteThresholdTest = init.then(settleOwedBurn)
    .expect(s.burned and not(canQuote) and s.quotes == 0 and invariant)
}

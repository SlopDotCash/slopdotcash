// @source workers/fee-converter/buyback.ts
// @source workers/fee-converter/buyback-config.ts
// @source workers/fee-converter/evm.ts
// @source workers/fee-converter/core.ts
// @source workers/fee-converter/index.ts
// @source workers/fee-converter/native-gas.ts
// @source backend/fee-conversions/handler.ts
// @evidence workers/fee-converter/buyback.test.ts
// @evidence workers/fee-converter/buyback.integration.ts
// The Robinhood Chain run: activation, the fee claim that feeds the buyback,
// one SLOP purchase and one burn, with the token's pause switch and a moving
// price outside the Worker's control.
//
// Modes. The converter mode and the buyback mode are separate settings read
// once per run. The buyback is off unless both are set; a live buyback needs
// a live converter (parseBuybackConfig refuses the other combination, so it
// is not a reachable configuration here). With the buyback off, Robinhood
// keeps its earlier behavior exactly: no claim, no quote, no key. The key is
// loaded only by a run whose buyback is live. A dry run records decisions
// and signs nothing. `signedWithoutKey` records what a send really saw.
//
// Purchase. An exact approval is its own send; the swap is signed only when
// the simulated output meets the signed minimum, so a price that moved away
// refuses the send instead of filling badly. Burn. The burn is a transfer to
// the burn address of exactly the owed amount; a paused token only waits.
// Amounts: `fee` units claimed, of which half may be spent; each spent unit
// buys two SLOP units; half of the SLOP acquired is burned, once.
//
// Bounds: one fee claim of 2 units, one purchase, one burn, one send open at
// a time per token, as the journal's pending-token index enforces.
module buyback_market {
  type S = {
    converter: str, buyback: str, scan: str, key: bool,
    accrued: int, fee: int, claim: str, stable: int,
    allowance: bool, buy: str, spent: int, priceOk: bool,
    slop: int, acquired: int, paused: bool, burn: str, burned: int,
    signedWithoutKey: bool
  }
  var s: S
  pure val Modes = Set("off", "dry_run", "live")
  pure val Open = Set("submitted", "unknown")
  // The buyback's effective mode for a run that starts now.
  pure def effective(converter: str, buyback: str): str =
    if (converter == "off" or buyback == "off") "off" else buyback
  action init = s' = { converter: "off", buyback: "off", scan: "none", key: false,
    accrued: 2, fee: 0, claim: "none", stable: 0, allowance: false, buy: "none", spent: 0,
    priceOk: true, slop: 0, acquired: 0, paused: false, burn: "none", burned: 0,
    signedWithoutKey: false }

  // A live buyback under a converter that is not live is refused at parse time.
  action configure(converter: str, buyback: str): bool = all {
    not(buyback == "live" and converter == "dry_run"),
    s' = s.with("converter", converter).with("buyback", buyback) }
  // A recovery scan starts; the run keeps this mode and loads the key only for live.
  action startRun = all { s.scan == "none", s.converter != "off",
    s' = s.with("scan", effective(s.converter, s.buyback))
      .with("key", effective(s.converter, s.buyback) == "live") }
  action endRun = all { s.scan != "none", s' = s.with("scan", "none").with("key", false) }
  // Outside the Worker.
  action pause(flag: bool): bool = s' = s.with("paused", flag)
  action price(ok: bool): bool = s' = s.with("priceOk", ok)

  // The fee claim runs only for the buyback and signs only in its live mode.
  action signClaim = all { s.scan == "live", s.accrued > 0, s.claim == "none",
    s' = s.with("claim", "submitted").with("signedWithoutKey", s.signedWithoutKey or not(s.key)) }
  action claimFinalized = all { s.scan != "none", s.claim == "submitted",
    s' = s.with("claim", "finalized").with("fee", s.accrued).with("stable", s.stable + s.accrued)
      .with("accrued", 0) }
  // A dry run or an off buyback leaves the fee in the vault.
  action noteClaim = all { s.scan == "dry_run", s.accrued > 0, s' = s }

  // Half of the claimed fee, less what is already committed.
  val owed = s.fee / 2 - s.spent
  val buyOpen = Open.contains(s.buy) or s.buy == "approval"
  action signApproval = all { s.scan == "live", s.claim != "submitted", owed > 0, not(buyOpen),
    not(s.allowance),
    s' = s.with("buy", "approval").with("signedWithoutKey", s.signedWithoutKey or not(s.key)) }
  action approvalFinalized = all { s.scan != "none", s.buy == "approval",
    s' = s.with("buy", "none").with("allowance", true) }
  // The simulation of the built swap must meet the signed minimum.
  action signSwap = all { s.scan == "live", owed > 0, not(buyOpen), s.allowance, s.priceOk,
    s' = s.with("buy", "submitted").with("spent", s.spent + owed)
      .with("signedWithoutKey", s.signedWithoutKey or not(s.key)) }
  action refuseSwap = all { s.scan == "live", owed > 0, not(buyOpen), s.allowance, not(s.priceOk),
    s' = s }
  action loseSwapResponse = all { s.buy == "submitted", s' = s.with("buy", "unknown") }
  // The exact allowance is consumed by the swap it was approved for.
  action swapFinalized = all { s.scan != "none", Open.contains(s.buy), s.priceOk,
    s' = s.with("buy", "finalized").with("allowance", false).with("stable", s.stable - s.spent)
      .with("slop", s.slop + 2 * s.spent).with("acquired", s.acquired + 2 * s.spent) }
  // A swap whose price moved before inclusion reverts and releases its amount.
  action swapReverted = all { s.scan != "none", Open.contains(s.buy), not(s.priceOk),
    s' = s.with("buy", "none").with("spent", 0) }
  action noteBuy = all { s.scan == "dry_run", owed > 0, s' = s }

  val burnOwed = s.acquired / 2 - s.burned
  action signBurn = all { s.scan == "live", burnOwed > 0, s.burn == "none" or s.burn == "finalized",
    not(Open.contains(s.burn)), not(s.paused), s.slop >= burnOwed,
    s' = s.with("burn", "submitted").with("burned", s.burned + burnOwed)
      .with("signedWithoutKey", s.signedWithoutKey or not(s.key)) }
  action waitPaused = all { s.scan == "live", burnOwed > 0, s.paused, not(Open.contains(s.burn)),
    s' = s }
  action loseBurnResponse = all { s.burn == "submitted", s' = s.with("burn", "unknown") }
  action burnFinalized = all { s.scan != "none", Open.contains(s.burn), not(s.paused),
    s' = s.with("burn", "finalized").with("slop", s.slop - (s.acquired / 2)) }
  // A burn that lands while the token is paused reverts and releases its amount.
  action burnReverted = all { s.scan != "none", Open.contains(s.burn), s.paused,
    s' = s.with("burn", "none").with("burned", 0) }

  action step = {
    nondet converter = Modes.oneOf()
    nondet buyback = Modes.oneOf()
    nondet flag = Set(false, true).oneOf()
    any { configure(converter, buyback), startRun, endRun, pause(flag), price(flag),
      signClaim, claimFinalized, noteClaim, signApproval, approvalFinalized, signSwap, refuseSwap,
      loseSwapResponse, swapFinalized, swapReverted, noteBuy, signBurn, waitPaused,
      loseBurnResponse, burnFinalized, burnReverted }
  }

  val invariant = all {
    // Nothing is signed without the key, and the key is held only by a live run.
    not(s.signedWithoutKey), s.key implies s.scan == "live",
    // The purchase never spends more than half of the claimed fee.
    s.spent <= s.fee / 2, s.spent >= 0,
    // The unconverted half of the fee stays in the stablecoin.
    s.buy == "finalized" implies s.stable == s.fee - s.spent,
    // The burn never takes more than half of the SLOP acquired.
    s.burned <= s.acquired / 2,
    s.burn == "finalized" implies s.slop == s.acquired - s.acquired / 2,
    s.slop >= 0, s.stable >= 0,
    // An allowance exists only between its approval and its swap.
    s.buy == "finalized" implies not(s.allowance)
  }

  // Scenarios.
  run offKeepsRobinhoodUntouchedTest = init.then(configure("live", "off")).then(startRun)
    .expect(s.scan == "off" and not(s.key) and invariant).then(signClaim.fail())
  run dryRunSignsNothingTest = init.then(configure("live", "dry_run")).then(startRun).then(noteClaim)
    .expect(not(s.key) and s.claim == "none" and s.accrued == 2 and invariant).then(signClaim.fail())
  run liveBuybackNeedsLiveConverterTest = init.then(configure("dry_run", "live").fail())
  run converterOffStopsEverythingTest = init.then(configure("off", "live")).then(startRun.fail())
  run claimBuyBurnTest = init.then(configure("live", "live")).then(startRun).then(signClaim)
    .then(claimFinalized).then(signApproval).then(approvalFinalized).then(signSwap)
    .expect(s.spent == 1 and invariant).then(swapFinalized)
    .expect(s.stable == 1 and s.acquired == 2 and invariant).then(signBurn).then(burnFinalized)
    .expect(s.slop == 1 and s.burned == 1 and burnOwed == 0 and invariant).then(signBurn.fail())
  run swapNeedsItsFinalApprovalTest = init.then(configure("live", "live")).then(startRun)
    .then(signClaim).then(claimFinalized).then(signSwap.fail())
  run movedPriceRefusesTheSwapTest = init.then(configure("live", "live")).then(startRun)
    .then(signClaim).then(claimFinalized).then(signApproval).then(approvalFinalized)
    .then(price(false)).then(refuseSwap).expect(s.spent == 0 and s.buy == "none" and invariant)
    .then(signSwap.fail())
  run revertedSwapReleasesAndRetriesTest = init.then(configure("live", "live")).then(startRun)
    .then(signClaim).then(claimFinalized).then(signApproval).then(approvalFinalized).then(signSwap)
    .then(loseSwapResponse).then(price(false)).then(swapReverted)
    .expect(s.spent == 0 and s.stable == 2 and invariant).then(price(true)).then(signSwap)
    .then(swapFinalized).expect(s.acquired == 2 and invariant)
  run pausedTokenOnlyWaitsTest = init.then(configure("live", "live")).then(startRun).then(signClaim)
    .then(claimFinalized).then(signApproval).then(approvalFinalized).then(signSwap)
    .then(swapFinalized).then(pause(true)).then(waitPaused)
    .expect(s.burn == "none" and s.burned == 0 and invariant).then(signBurn.fail())
  run burnPausedInFlightRetriesOnceTest = init.then(configure("live", "live")).then(startRun)
    .then(signClaim).then(claimFinalized).then(signApproval).then(approvalFinalized).then(signSwap)
    .then(swapFinalized).then(signBurn).then(pause(true)).then(burnReverted)
    .expect(s.burned == 0 and s.slop == 2 and invariant).then(pause(false)).then(signBurn)
    .then(burnFinalized).expect(s.slop == 1 and s.burned == 1 and invariant)
  run offMidwayKeepsOpenSendsTest = init.then(configure("live", "live")).then(startRun)
    .then(signClaim).then(claimFinalized).then(signApproval).then(approvalFinalized).then(signSwap)
    .then(endRun).then(configure("live", "off")).then(startRun)
    .expect(s.buy == "submitted" and not(s.key) and invariant).then(swapFinalized)
    .expect(s.acquired == 2 and invariant).then(signBurn.fail())
}

// @source backend/security/report-deposit.ts
// @source backend/security/report-deposit-hold.ts
// @source backend/submission-fee/handler.ts
// @source src/lib/security-report-deposit.mjs
// @source migrations/0145_security_report_deposits.sql
// @source migrations/0147_security_report_deposit_claim_notice.sql
// @evidence backend/security/report-deposit.test.ts
// @evidence backend/security/submissions.test.ts
// @evidence scripts/security-report-deposit.test.ts
// The refundable SLOP deposit on one private report (PRD section 8, "Report
// deposit"; operator decision of 21 November 2026).
// reportDepositAsk: when the case is created, one row is written with it:
// `asked` in live mode, `recorded` in dry_run, none when the mode is off, the
// project turned the deposit off, no SLOP rate is in force or the reporter is
// exempt. A case that exists already never gets a row.
// depositHeldSql: an `asked` row with no payment and no outcome holds the
// report. Screening, the owner's notice, every decision and GitHub forwarding
// require "not held"; the reporter may still add a version.
// The Worker marks the row paid and may clear the payment again while no
// outcome is set (a reorganised block); the report then waits again.
// runReportDepositSweep: releaseUnpaid turns an unpaid ask into `recorded`
// when the mode is not live or the project turned the deposit off;
// decideOutcomes sets refund_due or kept_due on a paid row by
// reportDepositOutcome; the Worker then records refunded or kept.
// startReleasedWork, older-style link: a claim GitHub has not confirmed yet
// whose row was paid or released gets one try at its owner's notice;
// claim_notice_at records the try whether or not anyone could be told, so the
// claim never takes the sweep's slots again.
// reportDepositOutcome: not live or project off sends back; a first response
// that is not a keeping close sends back; 14 silent days send back; a
// duplicate, an out-of-scope close or a person's rejection marked spam keeps
// only after the latest decision stood 7 days with no open appeal; an open
// appeal and a report an appeal returned to the owner wait.
// Abstracted: one report; the 14 days are two ticks and the 7 days one tick;
// screening is one step and the routine pass's two calls are its result;
// amounts, the rate and the item hash are covered by the unit tests; who is
// exempt is one boolean. Bounds: four ticks. Source-only; not executed
// against the code.
module api_security_report_deposit {
  type Deposit = { mode: str, on: bool, exists: bool, before: bool, row: str,
    paid: bool, paidAt: int, outcome: str, reason: str, receipt: str,
    appeal: str, from: str, closedAt: int, spam: bool, request: str,
    screened: bool, notified: bool, forwarded: bool, now: int, asks: int,
    askedOutsideLive: bool, keptBad: bool, touchedHeld: bool,
    claim: bool, released: bool, claimTried: bool }
  var s: Deposit
  pure val SILENT = 2
  pure val STOOD = 1
  pure val openReceipt = Set("received", "needs-information", "triaging")
  pure val closes = Set("duplicate", "out-of-scope", "rejected")

  action init = s' = { mode: "dry_run", on: true, exists: false, before: false,
    row: "none", paid: false, paidAt: -1, outcome: "none", reason: "none",
    receipt: "none", appeal: "none", from: "none", closedAt: -1, spam: false,
    request: "none", screened: false, notified: false, forwarded: false, now: 0,
    asks: 0, askedOutsideLive: false, keptBad: false, touchedHeld: false,
    claim: false, released: false, claimTried: false }

  val held = s.row == "asked" and not(s.paid) and s.outcome == "none"
  val turnedOff = s.mode != "live" or not(s.on)

  // A reviewed configuration change, and the owner's setting.
  action setMode(mode: str): bool = all { s.mode != mode, s' = s.with("mode", mode) }
  action ownerSets(on: bool): bool = all { s.on != on, s' = s.with("on", on) }

  // The report is accepted and stored at once; the row commits with its case.
  // `claim` is an older-style link (`createCase`, mode `claim`) that GitHub
  // has not confirmed yet.
  def accepted(exempt: bool, rate: bool, claim: bool): Deposit = {
    val asks = s.mode != "off" and s.on and rate and not(exempt)
    val row = if (not(asks)) "none" else if (s.mode == "live") "asked" else "recorded"
    s.with("exists", true).with("receipt", "received").with("row", row)
      .with("asks", if (row == "asked") s.asks + 1 else s.asks)
      .with("askedOutsideLive", s.askedOutsideLive or (row == "asked" and s.mode != "live"))
      .with("claim", claim) }
  action accept(exempt: bool, rate: bool): bool = all { not(s.exists),
    s' = accepted(exempt, rate, false) }
  action acceptClaim(exempt: bool, rate: bool): bool = all { not(s.exists),
    s' = accepted(exempt, rate, true) }
  // A report from before the switch-on: it has a case and no row.
  action existedBefore = all { not(s.exists), s.mode != "live",
    s' = s.with("exists", true).with("before", true).with("receipt", "received") }

  // The Worker: an accepted deposit, and a reorganised one.
  action pay = all { s.row == "asked", not(s.paid), s.outcome == "none",
    s' = s.with("paid", true).with("paidAt", s.now) }
  action unpay = all { s.row == "asked", s.paid, s.outcome == "none",
    s' = s.with("paid", false).with("paidAt", -1) }
  action workerResolves = all { s.outcome == "refund_due" or s.outcome == "kept_due",
    s' = s.with("outcome", if (s.outcome == "refund_due") "refunded" else "kept") }

  // Work on the report. `touchedHeld` is computed from the state before the
  // step, not from the guard.
  def touch(after: Deposit): Deposit = after.with("touchedHeld", s.touchedHeld or held)
  action screen = all { s.exists, not(held), not(s.screened), s.receipt == "received",
    s' = touch(s.with("screened", true).with("notified", true)) }
  action forward = all { s.exists, not(held), s.screened, not(s.forwarded),
    s' = touch(s.with("forwarded", true)) }
  // The reporter adds a version: allowed while held, and never asked again.
  action revise = all { s.exists, openReceipt.contains(s.receipt), not(s.forwarded),
    s' = s.with("screened", false)
      .with("request", if (s.request == "person") "answered" else s.request) }
  // The routine pass: an acknowledgement, a close by its published rules, a
  // request for proof, or the close when that request's clock ends.
  action routine(result: str): bool = all { s.exists, not(held), s.appeal == "none",
    s.receipt == "received" or (s.receipt == "needs-information" and s.request == "routine"),
    result != "needs-information" or s.request == "none",
    s' = touch(s.with("receipt", result)
      .with("request", if (result == "needs-information") "routine" else s.request)
      .with("closedAt", if (closes.contains(result)) s.now else s.closedAt)
      .with("spam", false)) }
  // A person: a request without a clock, and a technical decision.
  action personAsks = all { s.exists, not(held), openReceipt.contains(s.receipt),
    s' = touch(s.with("receipt", "needs-information").with("request", "person")) }
  action decide(result: str, spam: bool): bool = all { s.exists, not(held),
    openReceipt.contains(s.receipt), not(spam) or result == "rejected",
    s' = touch(s.with("receipt", result).with("closedAt", s.now).with("spam", spam)) }
  // A routine close returns to the owner; a person's close goes to a reviewer.
  action appeal(routineClose: bool): bool = all { closes.contains(s.receipt), s.appeal != "open",
    s' = if (routineClose)
        s.with("appeal", "returned").with("from", s.receipt).with("receipt", "triaging")
      else s.with("appeal", "open").with("from", s.receipt).with("receipt", "disputed") }
  action decideAppeal(uphold: bool): bool = all { s.appeal == "open",
    s' = if (uphold) s.with("appeal", "upheld").with("receipt", s.from).with("closedAt", s.now)
      else s.with("appeal", "returned").with("receipt", "triaging") }
  action tick = all { s.now < 4, s' = s.with("now", s.now + 1) }

  // releaseUnpaid: an unpaid ask that no longer applies holds nothing.
  action sweepRelease = all { held, turnedOff,
    s' = s.with("row", "recorded").with("released", true) }
  // startReleasedWork, older-style link: one try at the owner's notice of a
  // paid or released claim. `reachable` is whether a technical approver with
  // current authority exists; the try is recorded either way.
  val claimReady = s.claim and not(held) and not(s.claimTried) and
    ((s.row == "asked" and s.paid) or (s.row == "recorded" and s.released))
  action sweepClaimNotice(reachable: bool): bool = all { claimReady,
    s' = touch(s.with("claimTried", true).with("notified", s.notified or reachable)) }
  // A permission-provider outage during the try records nothing: the claim
  // stays ready for the next sweep.
  action sweepClaimOutage = all { claimReady, s' = s }
  // reportDepositOutcome, on a paid row with no outcome.
  val stood = s.appeal != "open" and s.closedAt >= 0 and s.now >= s.closedAt + STOOD
  val decision: str =
    if (turnedOff) "turned-off"
    else if (s.receipt == "received") (if (s.now >= s.paidAt + SILENT) "silent" else "wait")
    else if (s.receipt == "needs-information") (if (s.request == "answered") "responded" else "wait")
    else if (s.receipt == "triaging") (if (s.appeal == "returned") "wait" else "responded")
    else if (s.receipt == "confirmed") "responded"
    else if (s.receipt == "duplicate" or s.receipt == "out-of-scope") (if (stood) s.receipt else "wait")
    else if (s.receipt == "rejected") (if (not(s.spam)) "responded" else if (stood) "spam" else "wait")
    else "wait"
  pure val keeping = Set("duplicate", "out-of-scope", "spam")
  action sweepOutcome = all { s.row == "asked", s.paid, s.outcome == "none", decision != "wait",
    val kept = keeping.contains(decision)
    // The ghost is computed from the raw state, not from the branch above.
    val properClose = s.mode == "live" and s.on and s.appeal != "open" and s.closedAt >= 0 and
      s.now >= s.closedAt + STOOD and
      (s.receipt == "duplicate" or s.receipt == "out-of-scope" or (s.receipt == "rejected" and s.spam))
    s' = s.with("outcome", if (kept) "kept_due" else "refund_due").with("reason", decision)
      .with("keptBad", s.keptBad or (kept and not(properClose))) }

  action step = any {
    existedBefore, pay, unpay, workerResolves, screen, forward, revise, personAsks,
    tick, sweepRelease, sweepOutcome,
    { nondet m = Set("off", "dry_run", "live").oneOf() setMode(m) },
    { nondet on = Set(true, false).oneOf() ownerSets(on) },
    { nondet e = Set(true, false).oneOf() nondet r = Set(true, false).oneOf() accept(e, r) },
    { nondet e = Set(true, false).oneOf() nondet r = Set(true, false).oneOf() acceptClaim(e, r) },
    { nondet reach = Set(true, false).oneOf() sweepClaimNotice(reach) },
    sweepClaimOutage,
    { nondet o = Set("triaging", "duplicate", "out-of-scope", "rejected", "needs-information").oneOf() routine(o) },
    { nondet o = Set("confirmed", "duplicate", "out-of-scope", "rejected").oneOf()
      nondet sp = Set(true, false).oneOf() decide(o, sp) },
    { nondet rc = Set(true, false).oneOf() appeal(rc) },
    { nondet u = Set(true, false).oneOf() decideAppeal(u) },
    s' = s,
  }

  val invariant = all {
    // A deposit is asked only in live mode, at most once, and never for a
    // report that existed before.
    not(s.askedOutsideLive), s.asks <= 1, s.before implies s.row == "none",
    // No screening, notice, decision or forward ever starts while held.
    not(s.touchedHeld),
    // A recorded row is never paid and never gets an outcome.
    s.row != "asked" implies (not(s.paid) and s.outcome == "none"),
    // An outcome exists only on a paid ask.
    s.outcome != "none" implies (s.row == "asked" and s.paid),
    // Kept only on a recorded keeping close that stood, with the switch live.
    not(s.keptBad),
    (s.outcome == "kept_due" or s.outcome == "kept") implies keeping.contains(s.reason),
    // An open appeal is the reviewer's path.
    (s.appeal == "open") iff (s.receipt == "disputed"),
    // Only a claim whose row was paid or released is ever tried.
    s.claimTried implies (s.claim and (s.paid or s.released)),
  }

  run liveAskHoldsTest = init.then(setMode("live")).then(accept(false, true))
    .expect(held and s.row == "asked" and invariant)
    .then(screen.fail())
  run heldIsNotDecidedTest = init.then(setMode("live")).then(accept(false, true))
    .then(routine("duplicate").fail())
  run heldIsNotDecidedByAPersonTest = init.then(setMode("live")).then(accept(false, true))
    .then(decide("rejected", true).fail())
  run heldIsNotForwardedTest = init.then(setMode("live")).then(accept(false, true))
    .then(forward.fail())
  run heldTakesAVersionTest = init.then(setMode("live")).then(accept(false, true)).then(revise)
    .expect(held and s.asks == 1 and invariant)
  run paidIsScreenedTest = init.then(setMode("live")).then(accept(false, true)).then(pay).then(screen)
    .expect(s.screened and s.notified and invariant)
  run dryRunRecordsAndHoldsNothingTest = init.then(accept(false, true))
    .expect(s.row == "recorded" and not(held)).then(screen)
    .expect(s.screened and invariant).then(pay.fail())
  run recordedIsNeverAnAskTest = init.then(accept(false, true)).then(setMode("live"))
    .expect(s.row == "recorded" and not(held) and invariant)
  run noRateAsksNobodyTest = init.then(setMode("live")).then(accept(false, false))
    .expect(s.row == "none" and not(held))
  run exemptIsNotAskedTest = init.then(setMode("live")).then(accept(true, true))
    .expect(s.row == "none" and not(held))
  run projectOffAsksNobodyTest = init.then(setMode("live")).then(ownerSets(false)).then(accept(false, true))
    .expect(s.row == "none")
  run existingReportIsNeverAskedTest = init.then(existedBefore).then(setMode("live")).then(revise)
    .expect(s.row == "none" and not(held) and invariant).then(accept(false, true).fail())
  run modeOffReleasesTest = init.then(setMode("live")).then(accept(false, true)).then(setMode("off"))
    .then(sweepRelease).expect(s.row == "recorded" and not(held)).then(screen)
    .expect(s.screened and invariant)
  run ownerOffReleasesTest = init.then(setMode("live")).then(accept(false, true)).then(ownerSets(false))
    .then(sweepRelease).expect(not(held) and invariant)
  run liveAndOnIsNotReleasedTest = init.then(setMode("live")).then(accept(false, true))
    .then(sweepRelease.fail())
  run acknowledgedIsSentBackTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(screen).then(routine("triaging")).then(sweepOutcome)
    .expect(s.outcome == "refund_due" and s.reason == "responded" and invariant)
  run silentIsSentBackAfterTheClockTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(tick).then(sweepOutcome.fail())
  run silentIsSentBackTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(tick).then(tick).then(sweepOutcome)
    .expect(s.outcome == "refund_due" and s.reason == "silent" and invariant)
  run duplicateWaitsSevenDaysTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("duplicate")).then(sweepOutcome.fail())
  run duplicateIsKeptAfterItStoodTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("duplicate")).then(tick).then(sweepOutcome)
    .expect(s.outcome == "kept_due" and s.reason == "duplicate" and invariant)
    .then(workerResolves).expect(s.outcome == "kept" and invariant)
  run noProofCloseIsSentBackTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("needs-information")).then(sweepOutcome.fail())
  run noProofClosedIsSentBackTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("needs-information")).then(routine("rejected")).then(sweepOutcome)
    .expect(s.outcome == "refund_due" and s.reason == "responded" and invariant)
  run spamByAPersonIsKeptTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(decide("rejected", true)).then(tick).then(sweepOutcome)
    .expect(s.outcome == "kept_due" and s.reason == "spam" and invariant)
  run plainRejectionIsSentBackTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(decide("rejected", false)).then(sweepOutcome)
    .expect(s.outcome == "refund_due" and s.reason == "responded" and invariant)
  run appealStopsTheClockTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("duplicate")).then(appeal(true)).then(tick).then(tick).then(tick)
    .then(sweepOutcome.fail())
  run finalDecisionAfterAppealDecidesTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("duplicate")).then(appeal(true)).then(decide("confirmed", false)).then(sweepOutcome)
    .expect(s.outcome == "refund_due" and s.reason == "responded" and invariant)
  run openAppealWaitsTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(decide("duplicate", false)).then(appeal(false)).then(tick).then(tick)
    .then(sweepOutcome.fail())
  run upheldAppealRestartsTheClockTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(decide("duplicate", false)).then(appeal(false)).then(tick).then(decideAppeal(true))
    .then(sweepOutcome.fail())
  run paidThenOffIsSentBackTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(routine("duplicate")).then(tick).then(setMode("dry_run")).then(sweepOutcome)
    .expect(s.outcome == "refund_due" and s.reason == "turned-off" and invariant)
  run reorganisedPaymentWaitsAgainTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(unpay).expect(held and invariant).then(screen.fail())
  run heldClaimIsNotToldTest = init.then(setMode("live")).then(acceptClaim(false, true))
    .expect(held and invariant).then(sweepClaimNotice(true).fail())
  run paidClaimIsToldOnceTest = init.then(setMode("live")).then(acceptClaim(false, true)).then(pay)
    .then(sweepClaimNotice(true)).expect(s.notified and s.claimTried and invariant)
    .then(sweepClaimNotice(true).fail())
  run unreachableClaimIsTriedOnceTest = init.then(setMode("live")).then(acceptClaim(false, true))
    .then(pay).then(sweepClaimNotice(false))
    .expect(not(s.notified) and s.claimTried and invariant)
    .then(sweepClaimNotice(true).fail())
  run outageClaimIsTriedAgainTest = init.then(setMode("live")).then(acceptClaim(false, true))
    .then(pay).then(sweepClaimOutage).expect(not(s.claimTried) and not(s.notified) and invariant)
    .then(sweepClaimNotice(true)).expect(s.notified and s.claimTried and invariant)
  run turnedOffClaimIsToldTest = init.then(setMode("live")).then(acceptClaim(false, true))
    .then(ownerSets(false)).then(sweepRelease).then(sweepClaimNotice(true))
    .expect(s.notified and not(held) and invariant)
  run dryRunClaimIsNotSweptTest = init.then(acceptClaim(false, true))
    .expect(s.row == "recorded" and not(held)).then(sweepClaimNotice(true).fail())
  run decidedDepositKeepsItsPaymentTest = init.then(setMode("live")).then(accept(false, true)).then(pay)
    .then(screen).then(routine("triaging")).then(sweepOutcome).then(unpay.fail())
}

// @source src/lib/submission-fee.mjs
// @source workers/submission-fee/core.ts
// @source workers/submission-fee/store.ts
// @source workers/submission-fee/chain.ts
// @source migrations/0139_submission_fee_deposits.sql
// @source backend/submission-fee/handler.ts
// @source workers/fee-converter/buyback-store.ts
// @evidence workers/submission-fee/submission-fee.test.ts
// @evidence src/lib/submission-fee.test.ts
// One submission-fee deposit and the pull request it names. The chain holds
// the fact (`chain`); the Worker's row follows it in two steps: recorded once
// the confirmation count is on top (`row == "seen"`), final once its block is
// finalized. `counts` abstracts the pure rule of section 3 (token, kept
// destination, amount, rate at the block time), fixed when the deposit is
// made. `known` says whether its token is in the table: a deposit of any
// other token never counts and is never resolved by the Worker, so only its
// payer's reclaim ends it. `asked` is Slopbot's row for the pull request and `outcome` is
// Slopbot's decision; the Worker never sets `refund_due` or `kept_due`. One
// deposit, one pull request, one other deposit that may have paid it first
// (`otherPaid`). The send journal is a separate model
// (submission_fee_send); here `resolve` is a mined resolver transaction.
// The public reads serve `paid` and `outcome` and change nothing. A deposit
// that names a private security report instead of a pull request is the
// separate model submission_fee_report_deposit.
module submission_fee_deposit {
  var s: { chain: str, counts: bool, known: bool, confirmed: bool, final: bool,
    row: str, accepted: int, asked: bool, otherPaid: bool, paid: bool,
    outcome: str, state: str, eventFinal: bool, waited: bool, income: bool,
    refundsSent: int, keptSent: int }
  action init = s' = { chain: "none", counts: false, known: true, confirmed: false, final: false,
    row: "none", accepted: -1, asked: false, otherPaid: false, paid: false,
    outcome: "none", state: "none", eventFinal: false, waited: false, income: false,
    refundsSent: 0, keptSent: 0 }

  // Slopbot asks a fee for the pull request; another deposit may pay it first.
  action ask = all { not(s.asked), s' = s.with("asked", true) }
  action payElsewhere = all { s.asked, not(s.paid), not(s.otherPaid), s.outcome == "none",
    s' = s.with("otherPaid", true) }
  // A payer deposits. Whether it satisfies the rule is fixed here. A token
  // outside the table never counts.
  action depositOf(counts, known) = all { s.chain == "none", counts implies known,
    s' = s.with("chain", "open").with("counts", counts).with("known", known) }
  action deposit(counts) = depositOf(counts, true)
  action confirm = all { s.chain == "open", not(s.confirmed), s' = s.with("confirmed", true) }
  action finalize = all { s.chain != "none", s.chain != "gone", s.confirmed, not(s.final),
    s' = s.with("final", true) }
  // A reorganisation removes an unfinalized deposit.
  action reorg = all { s.chain == "open", not(s.final), s' = s.with("chain", "gone") }
  action grace = all { not(s.waited), s' = s.with("waited", true) }

  // The Worker's scan. A confirmed deposit is recorded; a finalized one is
  // marked final; a row whose deposit the chain no longer reports is removed
  // and stops paying.
  action scanSeen = all { s.chain == "open", s.confirmed, s.row == "none",
    s' = s.with("row", "seen").with("state", "open") }
  action scanFinal = all { s.chain != "gone", s.chain != "none", s.final, s.row != "final",
    s' = s.with("row", "final").with("state", if (s.state == "none") "open" else s.state) }
  action scanGone = all { s.chain == "gone", s.row == "seen",
    s' = s.with("row", "none").with("state", "none").with("accepted", -1)
      .with("paid", if (s.outcome == "none") false else s.paid) }

  // Judgement. A deposit that counts marks its pull request paid first.
  action judgeAccept = all { s.row != "none", s.accepted == -1, s.counts, s.asked,
    not(s.otherPaid), s.outcome == "none" or s.paid,
    s' = s.with("accepted", 1).with("paid", true) }
  action judgeRefuse = all { s.row != "none", s.accepted == -1,
    not(s.counts) or s.otherPaid or (s.asked and s.outcome != "none" and not(s.paid)),
    s.asked or not(s.counts) or s.otherPaid,
    s' = s.with("accepted", 0) }
  // No request for this pull request: refused only after the finalized wait.
  action judgeUnknown = all { s.row == "final", s.accepted == -1, s.counts, not(s.asked), s.waited,
    s' = s.with("accepted", 0) }

  // Slopbot decides, only for a pull request this deposit paid.
  action decide(outcome) = all { s.paid, s.outcome == "none", Set("refund_due", "kept_due").contains(outcome),
    s' = s.with("outcome", outcome) }

  // What the pure rule allows for this deposit: refund, keep, or nothing.
  val action_ = if (s.row != "final" or not(Set("open", "refund_due", "kept_due").contains(s.state))) "none"
    else if (not(s.known)) "none"
    else if (s.accepted == 0) "refund"
    else if (s.accepted == 1 and s.paid and s.outcome == "refund_due") "refund"
    else if (s.accepted == 1 and s.paid and s.outcome == "kept_due") "keep"
    else "none"
  action markDue = all { action_ != "none",
    s' = s.with("state", if (action_ == "refund") "refund_due" else "kept_due") }
  // The resolver's transaction is mined: only while the contract still holds
  // the deposit open, and only as the rule allows.
  action resolve = all { action_ != "none", s.chain == "open",
    s' = s.with("chain", if (action_ == "refund") "refunded" else "kept")
      .with("refundsSent", s.refundsSent + (if (action_ == "refund") 1 else 0))
      .with("keptSent", s.keptSent + (if (action_ == "keep") 1 else 0)) }
  // The payer takes an unresolved deposit back after the contract's delay.
  action reclaim = all { s.chain == "open", s.final, s' = s.with("chain", "reclaimed") }
  action eventFinalized = all { Set("refunded", "kept", "reclaimed").contains(s.chain), not(s.eventFinal),
    s' = s.with("eventFinal", true) }
  // Final states come only from the contract's finalized events.
  action scanResolved = all { s.eventFinal, s.row == "final",
    Set("open", "refund_due", "kept_due").contains(s.state),
    s' = s.with("state", s.chain)
      .with("outcome", if (s.paid and s.accepted == 1) (if (s.chain == "kept") "kept" else "refunded") else s.outcome)
      .with("income", s.chain == "kept") }

  action step = { nondet b = Set(true, false).oneOf() nondet o = Set("refund_due", "kept_due").oneOf()
    any { ask, payElsewhere, deposit(b), depositOf(false, false), confirm, finalize, reorg, grace, scanSeen, scanFinal, scanGone,
      judgeAccept, judgeRefuse, judgeUnknown, decide(o), markDue, resolve, reclaim, eventFinalized,
      scanResolved, s' = s } }

  val invariant = all {
    // One deposit is resolved at most once, and never both ways.
    s.refundsSent + s.keptSent <= 1,
    // A fee is kept only for a counted deposit that paid a pull request Slopbot closed.
    s.keptSent == 1 implies (s.counts and s.accepted == 1 and s.paid),
    s.chain == "kept" implies s.keptSent == 1,
    // A deposit that does not count is never accepted and never kept.
    not(s.counts) implies (s.accepted != 1 and s.keptSent == 0),
    // The Worker never resolves a deposit of a token outside the table.
    not(s.known) implies (s.refundsSent + s.keptSent == 0 and s.accepted != 1),
    // Nothing is sent for a deposit that is not finalized.
    (s.refundsSent + s.keptSent == 1) implies s.final,
    // Two deposits never both pay one pull request.
    not(s.accepted == 1 and s.otherPaid),
    // The row's final state and fee income follow the chain, never ahead of it.
    Set("refunded", "kept", "reclaimed").contains(s.state) implies (s.state == s.chain and s.eventFinal),
    s.income implies (s.chain == "kept" and s.eventFinal and s.state == "kept"),
    // A removed row pays nothing.
    (s.row == "none" and s.accepted == 1) implies false
  }

  run paidBeforeFinalThenRefundedOnMergeTest = init.then(ask).then(deposit(true)).then(confirm)
    .then(scanSeen).then(judgeAccept)
    .expect(s.paid and not(s.final) and action_ == "none")
    .then(decide("refund_due")).then(resolve.fail())
  run mergeRefundTest = init.then(ask).then(deposit(true)).then(confirm).then(scanSeen).then(judgeAccept)
    .then(finalize).then(scanFinal).then(decide("refund_due")).then(markDue).then(resolve)
    .then(eventFinalized).then(scanResolved)
    .expect(s.state == "refunded" and s.outcome == "refunded" and not(s.income) and invariant)
  run closeKeepsAndCountsAsIncomeTest = init.then(ask).then(deposit(true)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeAccept).then(decide("kept_due")).then(markDue).then(resolve)
    .then(eventFinalized).then(scanResolved)
    .expect(s.state == "kept" and s.outcome == "kept" and s.income and invariant)
  run shortDepositRefundedNeverKeptTest = init.then(ask).then(deposit(false)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeRefuse).then(markDue).then(resolve).then(eventFinalized).then(scanResolved)
    .expect(s.state == "refunded" and not(s.paid) and s.keptSent == 0 and invariant)
  run secondDepositRefusedTest = init.then(ask).then(payElsewhere).then(deposit(true)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeAccept.fail())
  run secondDepositRefundedTest = init.then(ask).then(payElsewhere).then(deposit(true)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeRefuse).then(resolve)
    .expect(s.chain == "refunded" and not(s.paid) and invariant)
  run reorgUnpaysTest = init.then(ask).then(deposit(true)).then(confirm).then(scanSeen).then(judgeAccept)
    .then(reorg).then(scanGone).expect(not(s.paid) and s.row == "none" and s.accepted == -1 and invariant)
  run unknownItemWaitsTest = init.then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(judgeUnknown.fail())
  run unknownItemRefundedAfterWaitTest = init.then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(grace).then(judgeUnknown).then(resolve).expect(s.chain == "refunded" and invariant)
  run lateRequestStillCountsTest = init.then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(ask).then(judgeAccept).expect(s.paid and invariant)
  run reclaimIsARefundTest = init.then(ask).then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(judgeAccept).then(decide("kept_due")).then(reclaim).then(resolve.fail())
  run reclaimRecordedTest = init.then(ask).then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(judgeAccept).then(reclaim).then(eventFinalized).then(scanResolved)
    .expect(s.state == "reclaimed" and s.outcome == "refunded" and not(s.income) and invariant)
  run unknownTokenIsNeverResolvedTest = init.then(ask).then(depositOf(false, false)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeRefuse)
    .expect(s.accepted == 0 and action_ == "none" and invariant)
    .then(markDue.fail())
  run unknownTokenNotResolvedTest = init.then(ask).then(depositOf(false, false)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeRefuse).then(resolve.fail())
  run unknownTokenReclaimedByPayerTest = init.then(depositOf(false, false)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeRefuse).then(reclaim).then(eventFinalized).then(scanResolved)
    .expect(s.state == "reclaimed" and s.refundsSent == 0 and not(s.income) and invariant)
  run undecidedSendsNothingTest = init.then(ask).then(deposit(true)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeAccept).then(resolve.fail())
}

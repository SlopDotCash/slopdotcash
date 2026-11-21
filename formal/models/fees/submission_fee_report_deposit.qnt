// @source workers/submission-fee/report.ts
// @source workers/submission-fee/core.ts
// @source workers/submission-fee/store.ts
// @source migrations/0145_security_report_deposits.sql
// @source src/lib/security-report-deposit.mjs
// @evidence workers/submission-fee/report.test.ts
// @evidence workers/submission-fee/submission-fee.test.ts
// One deposit that names a private security report, and that report's row in
// `security_report_deposits`. The backend owns the row: it writes it as
// `asked` (a deposit is needed) or `recorded` (record-only mode; nothing is
// asked), and later sets `refund_due` or `kept_due` on a paid row. The Worker
// only marks the row paid, clears that mark when an unfinalized deposit is
// reorganised away while the row is undecided, sends what the row says, and
// writes the final `refunded` or `kept` from the contract's finalized event.
// `counts` abstracts the pure rule of `reportDepositCounts`, fixed when the
// deposit is made: Robinhood Chain, SLOP, kept to the burn address, at least
// the amount asked. `known` says whether the token is in the table at all: a
// deposit of any other token is never resolved, so only its payer's reclaim
// ends it. A `recorded` row or no row makes the deposit an unknown item: it
// waits a day after finalization and is then refused and refunded.
// `otherPaid` is another deposit that paid the report first. The chain scan,
// confirmation and finality are the ones of submission_fee_deposit; the send
// journal is submission_fee_send.
module submission_fee_report_deposit {
  var s: { row: str, chain: str, counts: bool, known: bool, confirmed: bool, final: bool,
    drow: str, accepted: int, otherPaid: bool, paid: bool, outcome: str, state: str,
    eventFinal: bool, waited: bool, refundsSent: int, keptSent: int }
  action init = s' = { row: "none", chain: "none", counts: false, known: true, confirmed: false,
    final: false, drow: "none", accepted: -1, otherPaid: false, paid: false, outcome: "none",
    state: "none", eventFinal: false, waited: false, refundsSent: 0, keptSent: 0 }

  // The backend writes the report's row once, in the mode of that moment.
  action writeRow(mode) = all { s.row == "none", Set("asked", "recorded").contains(mode),
    s' = s.with("row", mode) }
  action payElsewhere = all { s.row == "asked", not(s.paid), not(s.otherPaid), s.outcome == "none",
    s' = s.with("otherPaid", true) }
  // A payer deposits. Whether it meets the rule is fixed here.
  action depositOf(counts, known) = all { s.chain == "none", counts implies known,
    s' = s.with("chain", "open").with("counts", counts).with("known", known) }
  action deposit(counts) = depositOf(counts, true)
  action confirm = all { s.chain == "open", not(s.confirmed), s' = s.with("confirmed", true) }
  action finalize = all { s.chain != "none", s.chain != "gone", s.confirmed, not(s.final),
    s' = s.with("final", true) }
  action reorg = all { s.chain == "open", not(s.final), s' = s.with("chain", "gone") }
  action grace = all { not(s.waited), s' = s.with("waited", true) }

  // The Worker's scan, as for a pull request's deposit. A deposit row whose
  // deposit the chain no longer reports is removed; the report stops being
  // paid only while its row is undecided.
  action scanSeen = all { s.chain == "open", s.confirmed, s.drow == "none",
    s' = s.with("drow", "seen").with("state", "open") }
  action scanFinal = all { s.chain != "gone", s.chain != "none", s.final, s.drow != "final",
    s' = s.with("drow", "final").with("state", if (s.state == "none") "open" else s.state) }
  action scanGone = all { s.chain == "gone", s.drow == "seen",
    s' = s.with("drow", "none").with("state", "none").with("accepted", -1)
      .with("paid", if (s.outcome == "none") false else s.paid) }

  // Judgement. Only an asked row is read; a deposit that counts marks it paid.
  action judgeAccept = all { s.drow != "none", s.accepted == -1, s.row == "asked", s.counts,
    not(s.otherPaid), s.outcome == "none" or s.paid,
    s' = s.with("accepted", 1).with("paid", true) }
  action judgeRefuse = all { s.drow != "none", s.accepted == -1, s.row == "asked",
    not(s.counts) or s.otherPaid or (s.outcome != "none" and not(s.paid)),
    s' = s.with("accepted", 0) }
  // No asked row. A token outside the table, or a destination that fits no
  // accepted token, is refused at once; anything else waits the day.
  action judgeNoRowAtOnce = all { s.drow != "none", s.accepted == -1, s.row != "asked", not(s.counts),
    s' = s.with("accepted", 0) }
  action judgeUnknown = all { s.drow == "final", s.accepted == -1, s.row != "asked", s.waited,
    s' = s.with("accepted", 0) }

  // The backend decides, only on a paid row with no outcome.
  action decide(outcome) = all { s.paid, s.outcome == "none", Set("refund_due", "kept_due").contains(outcome),
    s' = s.with("outcome", outcome) }

  // What `reportResolveAction` (accepted) and `submissionResolveAction`
  // (refused) allow for this deposit: refund, keep, or nothing.
  val action_ = if (s.drow != "final" or not(Set("open", "refund_due", "kept_due").contains(s.state))) "none"
    else if (not(s.known)) "none"
    else if (s.accepted == 0) "refund"
    else if (s.accepted == 1 and s.paid and s.row == "asked" and s.outcome == "refund_due") "refund"
    else if (s.accepted == 1 and s.paid and s.row == "asked" and s.outcome == "kept_due" and s.counts) "keep"
    else "none"
  action markDue = all { action_ != "none",
    s' = s.with("state", if (action_ == "refund") "refund_due" else "kept_due") }
  action resolve = all { action_ != "none", s.chain == "open",
    s' = s.with("chain", if (action_ == "refund") "refunded" else "kept")
      .with("refundsSent", s.refundsSent + (if (action_ == "refund") 1 else 0))
      .with("keptSent", s.keptSent + (if (action_ == "keep") 1 else 0)) }
  action reclaim = all { s.chain == "open", s.final, s' = s.with("chain", "reclaimed") }
  action eventFinalized = all { Set("refunded", "kept", "reclaimed").contains(s.chain), not(s.eventFinal),
    s' = s.with("eventFinal", true) }
  // Final states come only from the contract's finalized events. The row
  // this deposit paid gets `kept` or `refunded`; a reclaim is a refund.
  action scanResolved = all { s.eventFinal, s.drow == "final",
    Set("open", "refund_due", "kept_due").contains(s.state),
    s' = s.with("state", s.chain)
      .with("outcome", if (s.paid and Set("none", "refund_due", "kept_due").contains(s.outcome))
        (if (s.chain == "kept") "kept" else "refunded") else s.outcome) }

  action step = { nondet b = Set(true, false).oneOf() nondet o = Set("refund_due", "kept_due").oneOf()
    nondet m = Set("asked", "recorded").oneOf()
    any { writeRow(m), payElsewhere, deposit(b), depositOf(false, false), confirm, finalize, reorg, grace,
      scanSeen, scanFinal, scanGone, judgeAccept, judgeRefuse, judgeNoRowAtOnce, judgeUnknown, decide(o),
      markDue, resolve, reclaim, eventFinalized, scanResolved, s' = s } }

  val invariant = all {
    // One deposit is resolved at most once, and never both ways.
    s.refundsSent + s.keptSent <= 1,
    // A deposit is kept only when it met the rule, paid an asked row, and
    // that row said kept_due when it was sent.
    s.keptSent == 1 implies (s.counts and s.accepted == 1 and s.paid and s.row == "asked"
      and Set("kept_due", "kept").contains(s.outcome)),
    s.chain == "kept" implies s.keptSent == 1,
    // A recorded row, or no row, is never marked paid and keeps nothing.
    s.row != "asked" implies (not(s.paid) and s.accepted != 1 and s.keptSent == 0 and s.outcome == "none"),
    // A deposit that does not meet the rule is never accepted and never kept.
    not(s.counts) implies (s.accepted != 1 and s.keptSent == 0),
    // The Worker never resolves a deposit of a token outside the table.
    not(s.known) implies (s.refundsSent + s.keptSent == 0 and s.accepted != 1),
    // Nothing is sent for a deposit that is not finalized.
    (s.refundsSent + s.keptSent == 1) implies s.final,
    // Two deposits never both pay one report.
    not(s.accepted == 1 and s.otherPaid),
    // The deposit's and the report's final states follow the chain.
    Set("refunded", "kept", "reclaimed").contains(s.state) implies (s.state == s.chain and s.eventFinal),
    s.outcome == "kept" implies (s.chain == "kept" and s.eventFinal),
    s.outcome == "refunded" implies (Set("refunded", "reclaimed").contains(s.chain) and s.eventFinal),
    // A removed deposit row holds no judgement.
    s.drow == "none" implies s.accepted == -1
  }

  run paidBeforeFinalNothingSentTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm)
    .then(scanSeen).then(judgeAccept)
    .expect(s.paid and not(s.final) and action_ == "none")
    .then(decide("kept_due")).then(resolve.fail())
  run responseSendsItBackTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm).then(scanSeen)
    .then(judgeAccept).then(finalize).then(scanFinal).then(decide("refund_due")).then(markDue).then(resolve)
    .then(eventFinalized).then(scanResolved)
    .expect(s.state == "refunded" and s.outcome == "refunded" and s.keptSent == 0 and invariant)
  run keptOnlyOnKeptDueTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeAccept).then(decide("kept_due")).then(markDue).then(resolve)
    .then(eventFinalized).then(scanResolved)
    .expect(s.state == "kept" and s.outcome == "kept" and s.keptSent == 1 and invariant)
  run undecidedSendsNothingTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeAccept).then(resolve.fail())
  run shortOrWrongTermsRefundedTest = init.then(writeRow("asked")).then(deposit(false)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeAccept.fail())
  run refusedDepositRefundedNeverKeptTest = init.then(writeRow("asked")).then(deposit(false)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeRefuse).then(markDue).then(resolve).then(eventFinalized)
    .then(scanResolved)
    .expect(s.state == "refunded" and not(s.paid) and s.outcome == "none" and s.keptSent == 0 and invariant)
  run recordedRowIsNotAnAskTest = init.then(writeRow("recorded")).then(deposit(true)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeAccept.fail())
  run recordedRowWaitsTest = init.then(writeRow("recorded")).then(deposit(true)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeUnknown.fail())
  run recordedRowRefundedAfterWaitTest = init.then(writeRow("recorded")).then(deposit(true)).then(confirm)
    .then(finalize).then(scanFinal).then(grace).then(judgeUnknown).then(markDue).then(resolve)
    .expect(s.chain == "refunded" and not(s.paid) and s.keptSent == 0 and invariant)
  run noRowRefundedAfterWaitTest = init.then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(grace).then(judgeUnknown).then(resolve).expect(s.chain == "refunded" and invariant)
  run lateRowStillCountsTest = init.then(deposit(true)).then(confirm).then(finalize).then(scanFinal)
    .then(writeRow("asked")).then(judgeAccept).expect(s.paid and invariant)
  run secondDepositRefundedTest = init.then(writeRow("asked")).then(payElsewhere).then(deposit(true))
    .then(confirm).then(finalize).then(scanFinal).then(judgeRefuse).then(resolve)
    .expect(s.chain == "refunded" and not(s.paid) and invariant)
  run reorgUnpaysTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm).then(scanSeen)
    .then(judgeAccept).then(reorg).then(scanGone)
    .expect(not(s.paid) and s.drow == "none" and s.accepted == -1 and invariant)
  run reorgAfterDecisionKeepsPaidMarkTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm)
    .then(scanSeen).then(judgeAccept).then(decide("refund_due")).then(reorg).then(scanGone)
    .expect(s.paid and s.outcome == "refund_due" and s.refundsSent == 0 and invariant)
  run reclaimedDepositIsNotSentForTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeAccept).then(decide("kept_due")).then(reclaim)
    .then(resolve.fail())
  run reclaimIsSentBackTest = init.then(writeRow("asked")).then(deposit(true)).then(confirm).then(finalize)
    .then(scanFinal).then(judgeAccept).then(decide("kept_due")).then(reclaim)
    .then(eventFinalized).then(scanResolved)
    .expect(s.state == "reclaimed" and s.outcome == "refunded" and s.keptSent == 0 and invariant)
  run unknownTokenNeverResolvedTest = init.then(writeRow("asked")).then(depositOf(false, false)).then(confirm)
    .then(finalize).then(scanFinal).then(judgeRefuse)
    .expect(s.accepted == 0 and action_ == "none" and invariant)
    .then(resolve.fail())
}

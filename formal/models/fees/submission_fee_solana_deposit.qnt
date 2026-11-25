// @source workers/submission-fee/solana-core.ts
// @source workers/submission-fee/solana.ts
// @source workers/submission-fee/config.ts
// @source workers/submission-fee/index.ts
// @source workers/submission-fee/store.ts
// @source contracts/solana/submission-deposits.ts
// @source migrations/0155_submission_fee_solana.sql
// @source src/lib/submission-fee.mjs
// @source scripts/release-submission-fee.ts
// @source workers/fee-converter/buyback-store.ts
// @evidence workers/submission-fee/solana.test.ts
// @evidence contracts/solana/submission-deposits.test.ts
// @evidence scripts/release-submission-fee.test.ts
// @evidence workers/fee-converter/submission-fee-income.test.ts
// One deposit of the Solana deposit program, deposit A, as the Worker's
// Solana ledger handles it, and the record address it lives at. The address
// follows from the payer and a nonce the payer picked, so after A is settled
// the same payer can make a later deposit, B, at the same address. The
// Worker keys A by the id the program stored, never by the address.
//
// `published` is the program id in the reviewed table and `mode` the Solana
// ledger's own switch; with either off nothing is read or signed. `at` is
// what the address holds: nothing, A or B. `a` is A's state on chain. The
// Worker reads only finalized state, so reading and recording are one step.
// `row` is A's row. `known` is whether A is of the table's mint with the fee
// wallet as kept wallet: the endpoint lists only such records, so any other
// deposit is never fetched or recorded. `counts` is the pure rule fixed at
// deposit time (it also pays its pull request's fee). `courtesy` marks a
// refused deposit of the right amount that paid for nothing, which the
// Worker may still refund; any other refused deposit is final for the
// Worker and left to its payer. `due` is what the pull request's row says
// (Slopbot's).
// `usable` is whether the wallet a payout would go to has a token account
// that exists, is its own and is not frozen. `signed` is the one resolve
// transaction in flight, which names A's id; `expired` is its blockhash.
// `search` is the bounded search for a settlement the Worker did not send
// (the payer's reclaim): it is opened once, runs a bounded number of reads
// in each run and continues where it stopped. `aside` is A set aside after
// a read or proof of its own failed; it is tried again and never stops
// anything else.
// The judging rule, the paid mark and the send journal are the ones of
// submission_fee_deposit and submission_fee_send.
module submission_fee_solana_deposit {
  var s: { published: bool, mode: str, at: str, a: str, b: str, counts: bool, known: bool,
    row: str, accepted: int, due: str, usable: bool, parked: bool, signed: str, expired: bool,
    refundsSent: int, keptSent: int, income: int, unseen: bool, courtesy: bool, search: bool,
    aside: bool }
  action init = s' = { published: false, mode: "off", at: "none", a: "none", b: "none", counts: false,
    known: true, row: "none", accepted: -1, due: "none", usable: true, parked: false, signed: "none",
    expired: false, refundsSent: 0, keptSent: 0, income: 0, unseen: false, courtesy: false,
    search: false, aside: false }

  // The operator's separate reviewed changes.
  action publish = all { not(s.published), s' = s.with("published", true) }
  action setMode(mode) = all { Set("off", "dry_run", "live").contains(mode), s' = s.with("mode", mode) }
  val reads = s.published and s.mode != "off"

  // The payer. A deposit needs a published program; whether it meets the
  // rule is fixed here. B reuses A's address once A's record is closed.
  action depositOf(counts, known, courtesy) = all { s.published, s.a == "none", s.at == "none",
    counts implies known, courtesy implies (known and not(counts)),
    s' = s.with("a", "open").with("at", "A").with("counts", counts).with("known", known)
      .with("courtesy", courtesy) }
  action depositAgain = all { Set("refunded", "kept", "reclaimed").contains(s.a), s.at == "none",
    s.b == "none", s' = s.with("b", "open").with("at", "B") }
  action reclaim = all { s.a == "open", s' = s.with("a", "reclaimed").with("at", "none") }
  action reclaimB = all { s.b == "open", s' = s.with("b", "reclaimed").with("at", "none") }
  // The wallet's token account is closed, frozen or handed over, or made again.
  action setUsable(usable) = s' = s.with("usable", usable)
  // Slopbot decides the pull request A paid.
  action decide(outcome) = all { s.accepted == 1, s.due == "none",
    Set("refund_due", "kept_due").contains(outcome), s' = s.with("due", outcome) }

  // The scan records A while its record is open at the address and the
  // endpoint's filter lists it. A deposit settled before it was ever
  // recorded is skipped for good.
  action record = all { reads, s.known, s.at == "A", s.row == "none", s' = s.with("row", "open") }
  action skipUnseen = all { reads, s.a != "none", s.a != "open", s.row == "none", not(s.unseen),
    s' = s.with("unseen", true) }
  action judge = all { reads, s.row == "open", s.accepted == -1,
    s' = s.with("accepted", if (s.counts) 1 else 0) }

  // What is due for A: an accepted deposit follows its pull request's row.
  // A refused one goes back only as a courtesy; any other is never sent for.
  val final_ = s.accepted == 0 and not(s.courtesy)
  val action_ = if (not(Set("open", "refund_due", "kept_due").contains(s.row)) or not(s.known)) "none"
    else if (s.accepted == 0) (if (s.courtesy) "refund" else "none")
    else if (s.accepted == 1 and s.due == "refund_due") "refund"
    else if (s.accepted == 1 and s.due == "kept_due" and s.counts) "keep"
    else "none"
  action markDue = all { reads, action_ != "none",
    s' = s.with("row", if (action_ == "refund") "refund_due" else "kept_due") }

  // Sending, live only. Right before signing the Worker reads the address
  // again: it signs only when the address still holds A, and names A's id.
  // An unusable destination parks the deposit and signs nothing.
  action park = all { reads, s.mode == "live", action_ != "none", s.signed == "none", s.at == "A",
    not(s.usable), not(s.parked), s' = s.with("parked", true) }
  action unpark = all { reads, s.mode == "live", s.parked, s.usable or s.at != "A",
    s' = s.with("parked", false) }
  action sign = all { reads, s.mode == "live", action_ != "none", s.signed == "none", s.at == "A",
    s.usable, not(s.parked), s' = s.with("signed", action_).with("expired", false) }
  // The signed bytes land. The program settles A only when the address
  // still holds the deposit the instruction names and the destination is
  // usable; for anything else, B included, the whole transaction fails.
  action land = all { s.signed != "none", not(s.expired),
    if (s.at == "A" and s.usable)
      s' = s.with("a", if (s.signed == "refund") "refunded" else "kept").with("at", "none")
        .with("refundsSent", s.refundsSent + (if (s.signed == "refund") 1 else 0))
        .with("keptSent", s.keptSent + (if (s.signed == "keep") 1 else 0)).with("signed", "none")
    else s' = s.with("signed", "none") }
  // The blockhash expires unlanded; the send is failed and A is sent again.
  action expire = all { s.signed != "none", not(s.expired), s' = s.with("expired", true) }
  action reconcileExpired = all { reads, s.mode == "live", s.signed != "none", s.expired,
    s' = s.with("signed", "none").with("expired", false) }

  // A recorded deposit whose record is gone, or whose address now holds B,
  // is settled. One the Worker sent is recorded from that transaction. A
  // kept fee is income only from here, after the transaction proved it.
  val gone = reads and Set("open", "refund_due", "kept_due").contains(s.row) and s.at != "A"
  action ownSettled = all { gone, Set("refunded", "kept").contains(s.a),
    s' = s.with("row", s.a).with("parked", false).with("aside", false).with("search", false)
      .with("income", s.income + (if (s.a == "kept" and s.accepted == 1) 1 else 0)) }
  // Any other settlement is the payer's own reclaim. Its search is opened
  // once, and never for a deposit that is final for the Worker. Each step
  // reads a bounded number of transactions: it finds A's own settlement,
  // the oldest since A was last seen open, or stops and continues later.
  action openSearch = all { gone, s.a == "reclaimed", not(final_), not(s.search),
    s' = s.with("search", true) }
  action searchStep(found) = all { reads, s.search, Set("open", "refund_due", "kept_due").contains(s.row),
    if (found) s' = s.with("row", s.a).with("parked", false).with("aside", false).with("search", false)
    else s' = s }
  // A read or proof for A fails: A is set aside and tried again. Nothing
  // else about A, and nothing about any other deposit, changes.
  action setAside = all { gone, not(s.aside), s' = s.with("aside", true) }

  action step = { nondet c = Set(true, false).oneOf() nondet k = Set(true, false).oneOf()
    nondet m = Set("off", "dry_run", "live").oneOf() nondet o = Set("refund_due", "kept_due").oneOf()
    nondet y = Set(true, false).oneOf()
    any { publish, setMode(m), depositOf(c, k, y), depositAgain, reclaim, reclaimB, setUsable(k), decide(o),
      record, skipUnseen, judge, markDue, park, unpark, sign, land, expire, reconcileExpired, ownSettled,
      openSearch, searchStep(y), setAside, s' = s } }

  val invariant = all {
    // A is resolved at most once, and never both ways.
    s.refundsSent + s.keptSent <= 1,
    // The Worker's transaction never settles the later deposit at A's address.
    s.b != "refunded", s.b != "kept",
    // A is kept only when it met the rule, was accepted and its row said kept.
    s.keptSent == 1 implies (s.counts and s.accepted == 1 and s.due == "kept_due"),
    s.a == "kept" implies s.keptSent == 1,
    // A deposit the endpoint's filter does not list is never recorded,
    // judged, signed for or resolved.
    not(s.known) implies (s.row == "none" and s.refundsSent + s.keptSent == 0 and s.signed == "none"),
    // A refused deposit that is final for the Worker is never sent for: its
    // payer reclaims it. No search is opened for it once it is judged; one
    // opened before the judgement only ever records the payer's own reclaim.
    final_ implies (s.signed == "none" and s.refundsSent + s.keptSent == 0
      and Set("open", "reclaimed").contains(s.row)),
    // A search or a set-aside deposit has no recorded outcome yet.
    (s.search or s.aside) implies Set("open", "refund_due", "kept_due").contains(s.row),
    // Nothing is recorded or signed without a published program.
    not(s.published) implies (s.row == "none" and s.signed == "none" and s.a == "none"),
    // A deposit never recorded is never judged, sent for or income.
    s.row == "none" implies (s.accepted == -1 and s.signed == "none" and s.refundsSent + s.keptSent == 0),
    // The recorded outcome is A's own, whatever the address holds since.
    Set("refunded", "kept", "reclaimed").contains(s.row) implies s.row == s.a,
    // Kept fee income is counted once, and only for a kept, accepted deposit.
    s.income <= 1, s.income == 1 implies (s.row == "kept" and s.a == "kept" and s.accepted == 1),
    // An open deposit's record is at its address.
    s.a == "open" implies s.at == "A"
  }

  run offReadsNothingTest = init.then(publish).then(depositOf(true, true, false)).then(record.fail())
  run unpublishedTakesNoDepositTest = init.then(setMode("live")).then(depositOf(true, true, false).fail())
  run dryRunSignsNothingTest = init.then(publish).then(setMode("dry_run")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue)
    .expect(s.row == "refund_due").then(sign.fail())
  run refundOnMergeTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false)).then(record)
    .then(judge).then(decide("refund_due")).then(markDue).then(sign).then(land).then(ownSettled)
    .expect(s.row == "refunded" and s.refundsSent == 1 and s.income == 0 and invariant)
  run keptIsIncomeOnceTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false)).then(record)
    .then(judge).then(decide("kept_due")).then(markDue).then(sign).then(land).then(ownSettled)
    .expect(s.row == "kept" and s.keptSent == 1 and s.income == 1 and invariant).then(ownSettled.fail())
  run unlistedDepositIsNeverRecordedTest = init.then(publish).then(setMode("live"))
    .then(depositOf(false, false, false)).then(record.fail())
  run belowFeeIsFinalTest = init.then(publish).then(setMode("live")).then(depositOf(false, true, false))
    .then(record).then(judge).expect(s.accepted == 0 and action_ == "none").then(sign.fail())
  run belowFeeReclaimIsNotSearchedTest = init.then(publish).then(setMode("live"))
    .then(depositOf(false, true, false)).then(record).then(judge).then(reclaim).then(openSearch.fail())
  run courtesyRefundTest = init.then(publish).then(setMode("live")).then(depositOf(false, true, true))
    .then(record).then(judge).then(markDue).then(sign).then(land).then(ownSettled)
    .expect(s.row == "refunded" and s.keptSent == 0 and invariant)
  run payerReclaimIsSearchedInStepsTest = init.then(publish).then(setMode("live"))
    .then(depositOf(true, true, false)).then(record).then(judge).then(reclaim).then(openSearch)
    .then(searchStep(false)).expect(s.search and s.row == "open")
    .then(searchStep(true)).expect(s.row == "reclaimed" and not(s.search) and invariant)
  run searchIsOpenedOnceTest = init.then(publish).then(setMode("live"))
    .then(depositOf(true, true, false)).then(record).then(judge).then(reclaim).then(openSearch)
    .then(searchStep(false)).then(openSearch.fail())
  run setAsideIsTriedAgainTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue).then(sign).then(land)
    .then(setAside).expect(s.aside and s.row == "refund_due").then(ownSettled)
    .expect(s.row == "refunded" and not(s.aside) and invariant)
  run unusableAccountParksTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue).then(setUsable(false)).then(park)
    .expect(s.parked and s.signed == "none").then(sign.fail())
  run parkedReturnsWhenUsableTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue).then(setUsable(false)).then(park)
    .then(setUsable(true)).then(unpark).then(sign).then(land).then(ownSettled)
    .expect(s.row == "refunded" and invariant)
  run reusedAddressKeepsOwnOutcomeTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue).then(sign).then(land)
    .then(depositAgain).expect(s.at == "B").then(ownSettled)
    .expect(s.row == "refunded" and s.b == "open" and invariant)
  run changedAddressIsNotSignedForTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("kept_due")).then(markDue).then(reclaim).then(depositAgain)
    .expect(s.at == "B").then(sign.fail())
  run signedBytesCannotSettleLaterDepositTest = init.then(publish).then(setMode("live"))
    .then(depositOf(true, true, false)).then(record).then(judge).then(decide("kept_due")).then(markDue).then(sign)
    .then(reclaim).then(depositAgain).then(land)
    .expect(s.b == "open" and s.keptSent == 0 and s.signed == "none" and invariant).then(openSearch)
    .then(searchStep(true)).expect(s.row == "reclaimed" and s.income == 0)
  run expiredSendIsSentAgainTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue).then(sign).then(expire)
    .then(land.fail())
  run expiredThenResentTest = init.then(publish).then(setMode("live")).then(depositOf(true, true, false))
    .then(record).then(judge).then(decide("refund_due")).then(markDue).then(sign).then(expire)
    .then(reconcileExpired).then(sign).then(land).expect(s.refundsSent == 1 and invariant)
  run settledUnseenIsNeverRecordedTest = init.then(publish).then(depositOf(true, true, false)).then(reclaim)
    .then(setMode("live")).then(skipUnseen).expect(s.unseen and s.row == "none").then(record.fail())
}

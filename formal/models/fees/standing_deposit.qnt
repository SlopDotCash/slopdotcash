// @source src/lib/standing-deposit.mjs
// @source migrations/0149_standing_deposits.sql
// One contributor's standing deposit (operator decision, 23 November 2026;
// PRD section 5, "Standing deposit"; section 6, FEE-08) and two pull
// requests it may cover. The website writes the row and the withdrawal
// request, the Worker marks it paid and sends what is due, and Slopbot
// covers pull requests, watches them and decides the outcome from the pure
// rules `standingDepositCovers`, `standingCoverState` and
// `standingDepositDue`.
//
// Time is abstracted into flags: `windowOver[i]` (21 days after the later of
// opening and payment), `graceOver[i]` (48 hours after a strike was first
// seen), `waitOver` (21 days after coverage ended) and `expired` (340 days
// after payment). `merged[i]` holds when a maintainer merged a pull request
// of this author on the project before; the cap is modelled as one open
// covered pull request so the eleventh-of-ten case is reachable in two.
module standing_deposit {
  type Pr = { open: bool, covered: bool, closed: bool, merged: bool, labelled: bool,
    closedInWindow: bool, seen: bool, windowOver: bool, graceOver: bool, cover: str, asked: bool }
  pure val CAP = 1
  pure val noPr: Pr = { open: false, covered: false, closed: false, merged: false, labelled: false,
    closedInWindow: false, seen: false, windowOver: false, graceOver: false, cover: "none", asked: false }

  var row: str          // none | unpaid | cancelled | paid
  var withdrawn: bool
  var expired: bool
  var waitOver: bool
  var accepted: bool    // the project accepts standing deposits
  var mergedBefore: bool // the author had a merged pull request on the project
  var outcome: str      // none | refund_due | kept_due | refunded | kept
  var prs: int -> Pr
  var keptSent: int
  var refundSent: int

  action init = all { row' = "none", withdrawn' = false, expired' = false, waitOver' = false,
    accepted' = true, mergedBefore' = false, outcome' = "none",
    prs' = Map(0 -> noPr, 1 -> noPr), keptSent' = 0, refundSent' = 0 }

  action keepDeposit = all { row' = row, withdrawn' = withdrawn, expired' = expired, waitOver' = waitOver,
    accepted' = accepted, mergedBefore' = mergedBefore, outcome' = outcome,
    keptSent' = keptSent, refundSent' = refundSent }

  val openCovered = Set(0, 1).filter(i => prs.get(i).covered and prs.get(i).open).size()
  val coverEnded = withdrawn or expired
  val coveringNow = row == "paid" and outcome == "none" and not(coverEnded)

  // Website: post, cancel an unpaid row, request withdrawal of a paid one.
  action post = all { row == "none", row' = "unpaid", withdrawn' = withdrawn, expired' = expired,
    waitOver' = waitOver, accepted' = accepted, mergedBefore' = mergedBefore, outcome' = outcome,
    prs' = prs, keptSent' = keptSent, refundSent' = refundSent }
  action cancel = all { row == "unpaid", row' = "cancelled", withdrawn' = withdrawn, expired' = expired,
    waitOver' = waitOver, accepted' = accepted, mergedBefore' = mergedBefore, outcome' = outcome,
    prs' = prs, keptSent' = keptSent, refundSent' = refundSent }
  // Worker: an accepted deposit marks only an unpaid, uncancelled row paid.
  action pay = all { row == "unpaid", row' = "paid", withdrawn' = withdrawn, expired' = expired,
    waitOver' = waitOver, accepted' = accepted, mergedBefore' = mergedBefore, outcome' = outcome,
    prs' = prs, keptSent' = keptSent, refundSent' = refundSent }
  action withdraw = all { row == "paid", outcome == "none", not(withdrawn), row' = row,
    withdrawn' = true, expired' = expired, waitOver' = waitOver, accepted' = accepted,
    mergedBefore' = mergedBefore, outcome' = outcome, prs' = prs, keptSent' = keptSent,
    refundSent' = refundSent }
  action expire = all { row == "paid", not(expired), row' = row, withdrawn' = withdrawn,
    expired' = true, waitOver' = waitOver, accepted' = accepted, mergedBefore' = mergedBefore,
    outcome' = outcome, prs' = prs, keptSent' = keptSent, refundSent' = refundSent }
  action passWait = all { coverEnded, not(waitOver), row' = row, withdrawn' = withdrawn,
    expired' = expired, waitOver' = true, accepted' = accepted, mergedBefore' = mergedBefore,
    outcome' = outcome, prs' = prs, keptSent' = keptSent, refundSent' = refundSent }
  action ownerRefuses = all { accepted, row' = row, withdrawn' = withdrawn, expired' = expired,
    waitOver' = waitOver, accepted' = false, mergedBefore' = mergedBefore, outcome' = outcome,
    prs' = prs, keptSent' = keptSent, refundSent' = refundSent }
  action firstMerge = all { not(mergedBefore), row' = row, withdrawn' = withdrawn, expired' = expired,
    waitOver' = waitOver, accepted' = accepted, mergedBefore' = true, outcome' = outcome,
    prs' = prs, keptSent' = keptSent, refundSent' = refundSent }

  // The author opens a pull request on a project with the fee on.
  action openPr(i) = all { prs.get(i).cover == "none", not(prs.get(i).asked), not(prs.get(i).covered),
    not(prs.get(i).closed), not(prs.get(i).open),
    prs' = prs.set(i, { ...noPr, open: true }), keepDeposit }

  // Slopbot's gate: cover when every condition holds, otherwise ask per pull
  // request. An unpaid per pull request ask is taken back and covered later.
  val mayCover = coveringNow and accepted and mergedBefore and openCovered < CAP
  action cover(i) = all { prs.get(i).open, not(prs.get(i).covered), mayCover,
    prs' = prs.set(i, { ...prs.get(i), covered: true, asked: false, cover: "watch" }), keepDeposit }
  action ask(i) = all { prs.get(i).open, not(prs.get(i).covered), not(prs.get(i).asked), not(mayCover),
    prs' = prs.set(i, { ...prs.get(i), asked: true }), keepDeposit }

  // A maintainer merges, closes (in or after the window), labels, unlabels
  // or reopens.
  action merge(i) = all { prs.get(i).open, prs' = prs.set(i, { ...prs.get(i), open: false, merged: true }),
    keepDeposit }
  action close(i) = all { prs.get(i).open,
    prs' = prs.set(i, { ...prs.get(i), open: false, closed: true, closedInWindow: not(prs.get(i).windowOver) }),
    keepDeposit }
  action reopen(i) = all { prs.get(i).closed, not(prs.get(i).merged),
    prs' = prs.set(i, { ...prs.get(i), open: true, closed: false, closedInWindow: false, seen: false,
      graceOver: false }), keepDeposit }
  action label(i) = all { not(prs.get(i).labelled), prs' = prs.set(i, { ...prs.get(i), labelled: true }),
    keepDeposit }
  action unlabel(i) = all { prs.get(i).labelled,
    prs' = prs.set(i, { ...prs.get(i), labelled: false, seen: false, graceOver: false }), keepDeposit }
  action endWindow(i) = all { prs.get(i).covered, not(prs.get(i).windowOver),
    prs' = prs.set(i, { ...prs.get(i), windowOver: true }), keepDeposit }
  action endGrace(i) = all { prs.get(i).seen, not(prs.get(i).graceOver),
    prs' = prs.set(i, { ...prs.get(i), graceOver: true }), keepDeposit }

  // Slopbot's scheduled check of one cover: `standingCoverState`.
  pure def coverState(p: Pr): str =
    if (p.merged) "clear"
    else if (p.closed and p.closedInWindow and p.labelled) (if (p.seen and p.graceOver) "strike" else "pending")
    else if (p.windowOver) "clear" else "watch"
  pure def checked(p: Pr): Pr = {
    val q = { ...p, seen: p.seen or (p.closed and p.closedInWindow and p.labelled) }
    { ...q, cover: coverState(q) }
  }
  action check(i) = all { prs.get(i).covered, Set("watch", "pending").contains(prs.get(i).cover),
    prs' = prs.set(i, checked(prs.get(i))), keepDeposit }

  // Slopbot's outcome decision: `standingDepositDue`, written once.
  val states = Set(0, 1).filter(i => prs.get(i).covered).map(i => prs.get(i).cover)
  val due = if (row != "paid" or outcome != "none") "none"
    else if (states.contains("strike")) "kept_due"
    else if (coverEnded and waitOver and not(states.contains("pending"))) "refund_due"
    else "none"
  action decide = all { due != "none", row' = row, withdrawn' = withdrawn, expired' = expired,
    waitOver' = waitOver, accepted' = accepted, mergedBefore' = mergedBefore, outcome' = due,
    prs' = prs, keptSent' = keptSent, refundSent' = refundSent }

  // Worker: sends only what the row says, once.
  action send = all { Set("refund_due", "kept_due").contains(outcome), row' = row, withdrawn' = withdrawn,
    expired' = expired, waitOver' = waitOver, accepted' = accepted, mergedBefore' = mergedBefore,
    outcome' = if (outcome == "kept_due") "kept" else "refunded", prs' = prs,
    keptSent' = keptSent + (if (outcome == "kept_due") 1 else 0),
    refundSent' = refundSent + (if (outcome == "refund_due") 1 else 0) }

  action step = { nondet i = Set(0, 1).oneOf()
    any { post, cancel, pay, withdraw, expire, passWait, ownerRefuses, firstMerge, openPr(i), cover(i),
      ask(i), merge(i), close(i), reopen(i), label(i), unlabel(i), endWindow(i), endGrace(i), check(i),
      decide, send } }

  val strikeHappened = Set(0, 1).exists(i => prs.get(i).cover == "strike")
  val invariant = all {
    // One outcome, sent at most once, never both ways.
    keptSent + refundSent <= 1,
    // Kept only when a covered pull request was closed in its window, carried
    // the maintainer's label and both stood for the grace period.
    keptSent == 1 implies strikeHappened,
    Set("kept_due", "kept").contains(outcome) implies strikeHappened,
    // Sent back only after coverage ended and the wait passed.
    Set("refund_due", "refunded").contains(outcome) implies (coverEnded and waitOver),
    // A cancelled or never paid row has no outcome and covers nothing.
    row != "paid" implies (outcome == "none" and Set(0, 1).forall(i => not(prs.get(i).covered))),
    // A strike needs the grace period after it was first seen.
    Set(0, 1).forall(i => prs.get(i).cover == "strike" implies prs.get(i).seen)
  }

  // Scenarios.
  run coveredAndMergedSentBackTest = init.then(firstMerge).then(post).then(pay).then(openPr(0)).then(cover(0))
    .then(merge(0)).then(check(0)).then(withdraw).then(passWait).then(decide).then(send)
    .expect(outcome == "refunded" and refundSent == 1 and keptSent == 0 and invariant)
  run ordinaryCloseCostsNothingTest = init.then(firstMerge).then(post).then(pay).then(openPr(0))
    .then(cover(0)).then(close(0)).then(check(0)).then(endWindow(0)).then(check(0))
    .then(withdraw).then(passWait).then(decide)
    .expect(prs.get(0).cover == "clear" and outcome == "refund_due" and invariant)
  run strikeKeepsWholeDepositTest = init.then(firstMerge).then(post).then(pay).then(openPr(0)).then(cover(0))
    .then(close(0)).then(label(0)).then(check(0)).then(endGrace(0)).then(check(0)).then(decide).then(send)
    .expect(outcome == "kept" and keptSent == 1 and invariant)
  run labelRemovedInGraceClearsTest = init.then(firstMerge).then(post).then(pay).then(openPr(0))
    .then(cover(0)).then(close(0)).then(label(0)).then(check(0)).then(unlabel(0)).then(check(0))
    .expect(prs.get(0).cover == "watch" and due == "none" and invariant)
  run closedAfterWindowNeverStrikesTest = init.then(firstMerge).then(post).then(pay).then(openPr(0))
    .then(cover(0)).then(endWindow(0)).then(close(0)).then(label(0)).then(check(0))
    .expect(prs.get(0).cover == "clear" and invariant)
  run noMergeOnProjectIsAskedTest = init.then(post).then(pay).then(openPr(0)).then(ask(0))
    .expect(prs.get(0).asked and not(prs.get(0).covered)).then(cover(0).fail())
  run capAsksTheNextTest = init.then(firstMerge).then(post).then(pay).then(openPr(0)).then(cover(0))
    .then(openPr(1)).then(ask(1)).expect(prs.get(1).asked and invariant)
  run unpaidAskTakenBackOnPaymentTest = init.then(firstMerge).then(post).then(openPr(0)).then(ask(0))
    .then(pay).then(cover(0)).expect(prs.get(0).covered and not(prs.get(0).asked) and invariant)
  run withdrawalStopsNewCoversTest = init.then(firstMerge).then(post).then(pay).then(withdraw).then(openPr(0))
    .then(cover(0).fail())
  run pendingStrikeHoldsRefundTest = init.then(firstMerge).then(post).then(pay).then(openPr(0)).then(cover(0))
    .then(close(0)).then(label(0)).then(check(0)).then(withdraw).then(passWait)
    .expect(due == "none" and prs.get(0).cover == "pending")
  run ownerRefusalAsksTest = init.then(firstMerge).then(post).then(pay).then(ownerRefuses).then(openPr(0))
    .then(cover(0).fail())
  run cancelledRowCoversNothingTest = init.then(firstMerge).then(post).then(cancel).then(pay.fail())
  run expiryRefundsTest = init.then(firstMerge).then(post).then(pay).then(expire).then(passWait).then(decide)
    .expect(outcome == "refund_due" and invariant)
}

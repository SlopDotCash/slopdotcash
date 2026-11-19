// @source src/SubmissionFeePage.tsx
// @source src/SubmissionFeePay.tsx
// @source src/lib/submission-fee-page.ts
// @source src/lib/submission-fee-setup.ts
// @source src/lib/evm-fee-deposit.ts
// @evidence tests/e2e/submission-fee-pay.spec.ts
// @evidence tests/e2e/submission-fee-pay-chain.spec.ts
// @evidence backend/submission-fee/pay-page.test.ts
// @evidence backend/submission-fee/pay-wallet.test.ts
// The contributor pay page of the refundable submission fee, for one pull
// request and one visitor. The address only names the pull request. The page
// shows a way to pay only when the fee is switched on, the registry lists the
// repository, and the stored fee record matches the published address tables;
// a record that does not match is refused whole. A wallet is asked for an
// approval, then for the deposit, or for both in one atomic request. The
// record is read again just before each wallet request, so a pull request
// that someone else paid meanwhile is never paid twice from this page. One
// saved request exists at a time and no second prompt opens while it waits.
// The deposit is reported as received from a canonical block that carries the
// contract's own event and as finished only from a final block; a replaced
// block withdraws "received". The wallet's reply and status prove nothing.
// After this tab's deposit is final, the stored record may still say "due"
// until Slop records it; the page offers no second payment in that time. If
// an hour passes and the record is still unpaid, that deposit did not count,
// and the form is offered again.
// Abstracted: the address, item, amount and event predicates are the real
// `readFeeItem` and `checkFeeDeposit`; one way to pay stands for the list, three
// deposit requests stand for any number of retries, and two final deposits
// stand for any number after an hour without a record.
module ui_submission_fee_pay {
  var s: { switched: bool, listed: bool, served: str, view: str, formOpen: bool,
    atomic: bool, allowance: bool, review: str, saved: str, block: str, event: bool,
    reverted: bool, notice: str, asked: bool, depositPrompts: int, paidElsewhere: bool,
    watching: bool, deposited: bool, hourPassed: bool, made: int, waited: bool }
  action start(switched: bool, listed: bool, served: str, atomic: bool, event: bool,
    reverted: bool): bool = s' = { switched: switched, listed: listed, served: served,
    view: "loading", formOpen: false, atomic: atomic, allowance: false, review: "none",
    saved: "none", block: "none", event: event, reverted: reverted, notice: "none",
    asked: false, depositPrompts: 0, paidElsewhere: false, watching: false, deposited: false,
    hourPassed: false, made: 0, waited: false }
  action init = any {
    start(true, true, "due", false, true, false), start(true, true, "due", true, true, false),
    start(true, true, "due", false, false, false), start(true, true, "due", false, true, true),
    start(true, true, "tampered", false, true, false), start(true, true, "missing", false, true, false),
    start(true, true, "paid", false, true, false), start(true, false, "due", false, true, false),
    start(false, true, "due", false, true, false), start(false, true, "paid", false, true, false) }
  // What one read of the stored record shows. An unlisted repository is never looked up.
  pure def shown(listed: bool, served: str): str =
    if (not(listed)) "unlisted" else if (served == "missing") "not-asked"
    else if (served == "tampered") "refused" else served
  action load = all { s.view == "loading", s' = s.with("view", shown(s.listed, s.served)) }
  // Slop records a deposit, this visitor's or another payer's; the next read shows it.
  action recordPaid = all { s.served == "due", s' = s.with("served", "paid") }
  action anotherPayerPays = all { s.served == "due", s.block == "none", s.made == 0,
    s' = s.with("served", "paid").with("paidElsewhere", true) }
  action reread = all { s.view != "loading", s.listed, s' = s.with("view", shown(s.listed, s.served)) }
  val payable = s.switched and s.view == "due"
  action openForm = all { payable, not(s.formOpen), s' = s.with("formOpen", true) }
  // A review reads the wallet's chain: allowance, balance, batching. It signs nothing.
  // This tab's final deposit is on chain and the hour for recording it is not over.
  val awaitingRecord = s.deposited and not(s.hourPassed)
  action hourPasses = all { s.deposited, s.served == "due", not(s.hourPassed),
    s' = s.with("hourPassed", true).with("waited", true) }
  action reviewDeposit = all { s.formOpen, s.switched, s.view == "due", s.saved == "none",
    not(awaitingRecord), s.depositPrompts < 3, s.made < 2,
    s' = s.with("review", if (s.allowance) "deposit"
      else if (s.atomic) "batch" else "approve") }
  // Just before the wallet is asked the record is read again; a paid pull request stops here.
  val stillDue = s.served == "due"
  action refuseStale = all { s.review != "none", s.saved == "none", not(stillDue),
    s' = s.with("review", "none").with("view", shown(s.listed, s.served)) }
  action promptApproval = all { s.review == "approve", s.saved == "none", stillDue,
    s' = s.with("saved", "approve").with("review", "none").with("asked", true) }
  action promptDeposit = all { s.review == "deposit" or s.review == "batch", s.saved == "none",
    stillDue, not(awaitingRecord), s' = s.with("saved", "deposit").with("review", "none")
      .with("deposited", false).with("hourPassed", false).with("notice", "none")
      .with("asked", true).with("depositPrompts", s.depositPrompts + 1)
      .with("block", "unmined") }
  // A declined prompt sent nothing and leaves nothing saved.
  action walletDeclines = all { s.saved != "none", s.block == "none" or s.block == "unmined",
    s.notice == "none", s' = s.with("saved", "none").with("block", "none")
      .with("depositPrompts", if (s.saved == "deposit") s.depositPrompts - 1 else s.depositPrompts) }
  // An approval counts from canonical inclusion and only opens the next review.
  action approvalIncluded = all { s.saved == "approve",
    s' = s.with("saved", "none").with("allowance", true).with("review", "deposit") }
  action mine = all { s.block == "unmined", s' = s.with("block", "included") }
  action replace = all { s.block == "included", s' = s.with("block", "unmined") }
  action finalize = all { s.block == "included", s' = s.with("block", "final") }
  // The same check runs from a timer and from the button; it never opens a prompt.
  action check = all { s.saved == "deposit",
    s' = if (s.block == "final")
        (if (s.reverted) s.with("saved", "none").with("notice", "failed")
         else if (s.event) s.with("saved", "none").with("notice", "verified").with("watching", true)
           .with("deposited", true).with("made", s.made + 1)
         else s)
      else if (s.block == "included" and s.event and not(s.reverted))
        s.with("notice", "received").with("watching", true)
      else s.with("notice", if (s.notice == "received") "waiting" else s.notice) }
  action step = any { load, recordPaid, anotherPayerPays, reread, openForm, reviewDeposit,
    refuseStale, promptApproval, promptDeposit, walletDeclines, approvalIncluded, mine,
    replace, finalize, check, hourPasses, s' = s }
  val invariant = all {
    // A wallet is asked only with the fee on, a listed repository and a record that matched.
    s.asked implies (s.switched and s.listed and s.served != "tampered"
      and s.served != "missing"),
    s.formOpen implies s.switched,
    Set("refused", "unlisted", "not-asked").contains(s.view) implies not(s.formOpen),
    // The deposit is never asked for before its approval or without the atomic request.
    s.depositPrompts > 0 implies (s.allowance or s.atomic),
    // One request at a time. A failed deposit may be retried. A second final deposit
    // is possible only after the first was final for an hour with no record of it.
    s.depositPrompts <= 3,
    s.made <= 2,
    s.made == 2 implies s.waited,
    awaitingRecord implies (s.saved == "none" and s.review == "none"),
    // A pull request another payer paid before this tab sent anything is never paid from it.
    s.paidElsewhere implies s.made == 0,
    // Finished only from a final block that carries the contract's event.
    s.notice == "verified" implies (s.block == "final" and s.event and not(s.reverted)),
    s.notice == "received" implies (s.event and not(s.reverted) and s.block != "none"),
    s.notice == "failed" implies (s.block == "final" and s.reverted),
    s.watching implies s.depositPrompts >= 1,
    s.deposited implies s.watching
  }
  run twoRequestsTest = start(true, true, "due", false, true, false).then(load).then(openForm)
    .then(reviewDeposit).expect(s.review == "approve").then(promptApproval)
    .then(approvalIncluded).expect(s.review == "deposit" and s.asked)
    .then(promptDeposit).then(mine).then(check)
    .expect(s.notice == "received" and s.saved == "deposit")
    .then(recordPaid).then(reread).expect(s.view == "paid" and s.saved == "deposit")
    .then(finalize).then(check).expect(s.notice == "verified" and s.saved == "none")
  run oneRequestTest = start(true, true, "due", true, true, false).then(load).then(openForm)
    .then(reviewDeposit).expect(s.review == "batch").then(promptDeposit)
    .expect(s.asked and s.depositPrompts == 1)
  run switchedOffTest = start(false, true, "due", false, true, false).then(load)
    .expect(not(payable) and not(s.formOpen))
  run switchedOffStillShowsPaymentTest = start(false, true, "paid", false, true, false).then(load)
    .expect(s.view == "paid" and not(payable))
  run tamperedRecordTest = start(true, true, "tampered", false, true, false).then(load)
    .expect(s.view == "refused" and not(payable))
  run unlistedRepositoryTest = start(true, false, "due", false, true, false).then(load)
    .expect(s.view == "unlisted" and not(payable))
  run notAskedTest = start(true, true, "missing", false, true, false).then(load)
    .expect(s.view == "not-asked" and not(payable))
  run paidElsewhereTest = start(true, true, "due", false, true, false).then(load).then(openForm)
    .then(reviewDeposit).then(promptApproval).then(approvalIncluded).then(anotherPayerPays)
    .then(refuseStale).expect(s.depositPrompts == 0 and s.view == "paid" and s.review == "none")
  run declinedTest = start(true, true, "due", true, true, false).then(load).then(openForm)
    .then(reviewDeposit).then(promptDeposit).then(walletDeclines)
    .expect(s.saved == "none" and s.depositPrompts == 0)
  run replacedBlockTest = start(true, true, "due", true, true, false).then(load).then(openForm)
    .then(reviewDeposit).then(promptDeposit).then(mine).then(check)
    .expect(s.notice == "received").then(replace).then(check)
    .expect(s.notice == "waiting" and s.saved == "deposit")
  run revertedDepositTest = start(true, true, "due", false, true, true).then(load).then(openForm)
    .then(reviewDeposit).then(promptApproval).then(approvalIncluded).then(promptDeposit)
    .then(mine).then(finalize).then(check).expect(s.notice == "failed" and s.saved == "none")
  run noSecondDepositBeforeRecordTest = start(true, true, "due", true, true, false).then(load)
    .then(openForm).then(reviewDeposit).then(promptDeposit).then(mine).then(finalize).then(check)
    .expect(s.notice == "verified" and awaitingRecord and s.served == "due")
    .then(reviewDeposit.fail())
  run unrecordedAfterAnHourTest = start(true, true, "due", true, true, false).then(load)
    .then(openForm).then(reviewDeposit).then(promptDeposit).then(mine).then(finalize).then(check)
    .then(hourPasses).then(reviewDeposit).expect(s.review == "batch")
  run eventlessTransactionTest = start(true, true, "due", true, false, false).then(load)
    .then(openForm).then(reviewDeposit).then(promptDeposit).then(mine).then(finalize).then(check)
    .expect(s.notice == "none" and s.saved == "deposit")
}

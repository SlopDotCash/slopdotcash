// @source src/ReportDepositPage.tsx
// @source src/lib/report-deposit-page.ts
// @source src/lib/security-report-deposit.mjs
// @source src/lib/submission-fee-setup.ts
// @source src/SecurityBounty.tsx
// @source src/ProjectProposalPage.tsx
// @source src/PublicPages.tsx
// @evidence tests/e2e/report-deposit-pay.spec.ts
// @evidence tests/e2e/report-deposit.spec.ts
// @evidence backend/submission-fee/report-deposit-page.test.ts
// The pages of the refundable SLOP deposit on a private security report
// (operator decision, 21 November 2026; PRD section 8), for one report, one
// visitor and one project.
// The pay page: the address only names the case. The page shows the one way
// to pay only when the deposit is switched on, the address is a case id, and
// the stored record matches the published address tables; a record that does
// not match is refused whole, and an unreachable record is an error the
// visitor can retry. The record is read again just before the wallet is
// asked, so a report whose deposit someone else paid is never paid twice
// from this page. A recorded deposit and how it ended are shown whether or
// not the deposit is switched on.
// The reporter's Inbox line follows the stored row: "needed" links the pay
// page and nothing else does; "sent back" and "kept" read the public record
// once for the transaction that ended the deposit and link the pay page
// instead when that read fails. No other state reads the public record.
// The sentence before a report is filed shows only while the deposit is
// switched on and the project has not turned it off.
// The owner's checkbox is checked unless the project turned the deposit off.
// A project that never set it publishes nothing until its owner unticks it;
// publishing an unchanged choice changes nothing.
// Abstracted: the wallet steps between "asked" and a recorded deposit are the
// shared form of `ui_submission_fee_pay`; the address, item and amount
// predicates are the real `readReportDeposit`; three owner revisions stand for
// any number.
module ui_report_deposit {
  var s: {
    // What Slop asks, and the project's own setting: absent, on or off.
    switched: bool, initial: str, setting: str, checked: bool, revisions: int,
    // The stored row of this report's deposit:
    // none, needed, paid, refund_due, kept_due, refunded, kept.
    row: str,
    // The public read of that row: ok, tampered or unreachable.
    fault: str,
    // The pay page.
    named: bool, view: str, formOpen: bool, review: bool, asked: bool,
    paidElsewhere: bool,
    // The Inbox line's read of the transaction that ended the deposit.
    endRead: str
  }
  action start(switched: bool, setting: str, row: str, fault: str, named: bool): bool =
    s' = { switched: switched, initial: setting, setting: setting,
      checked: setting != "off", revisions: 0, row: row, fault: fault, named: named,
      view: if (named) "loading" else "bad-address", formOpen: false, review: false,
      asked: false, paidElsewhere: false, endRead: "idle" }
  action init = any {
    start(true, "absent", "needed", "ok", true), start(true, "on", "needed", "ok", true),
    start(true, "off", "none", "ok", true), start(true, "absent", "needed", "tampered", true),
    start(true, "absent", "needed", "unreachable", true),
    start(true, "absent", "needed", "ok", false), start(true, "absent", "none", "ok", true),
    start(true, "absent", "paid", "ok", true), start(true, "absent", "refunded", "ok", true),
    start(true, "absent", "kept", "unreachable", true),
    start(false, "absent", "needed", "ok", true), start(false, "absent", "kept", "ok", true),
    start(false, "absent", "none", "ok", true) }

  // ---- The pay page ----
  pure val RECORDED = Set("paid", "refund_due", "kept_due", "refunded", "kept")
  // What one read of the stored record shows.
  pure def shown(row: str, fault: str): str =
    if (fault == "unreachable") "error" else if (fault == "tampered") "refused"
    else if (row == "none") "not-asked" else if (row == "needed") "due" else "paid"
  action load = all { s.view == "loading", s' = s.with("view", shown(s.row, s.fault)) }
  action retry = all { s.view == "error", s' = s.with("view", "loading") }
  action routeRecovers = all { s.fault == "unreachable", s' = s.with("fault", "ok") }
  // The refresh of a record already on screen; a failed refresh keeps it.
  action reread = all { Set("due", "paid").contains(s.view),
    s' = if (s.fault == "ok") s.with("view", shown(s.row, s.fault)) else s }
  val payable = s.switched and s.view == "due"
  action openForm = all { payable, not(s.formOpen), s' = s.with("formOpen", true) }
  action reviewDeposit = all { s.formOpen, payable, not(s.asked),
    s' = s.with("review", true) }
  // Just before the wallet is asked the record is read again.
  val stillDue = s.row == "needed" and s.fault == "ok"
  action askWallet = all { s.review, stillDue, s' = s.with("review", false).with("asked", true) }
  action refuseStale = all { s.review, not(stillDue),
    s' = s.with("review", false)
      .with("view", if (s.fault == "ok") shown(s.row, s.fault) else s.view) }
  // Slop records a deposit: this visitor's, or another payer's before this tab asked.
  action recordPaid = all { s.row == "needed", s.asked, s' = s.with("row", "paid") }
  action anotherPayerPays = all { s.row == "needed", not(s.asked),
    s' = s.with("row", "paid").with("paidElsewhere", true) }
  // The report gets its outcome, and the resolver settles it.
  action decide(outcome: str): bool = all { s.row == "paid", s' = s.with("row", outcome) }
  action settle = all { Set("refund_due", "kept_due").contains(s.row),
    s' = s.with("row", if (s.row == "refund_due") "refunded" else "kept") }

  // ---- The reporter's Inbox line ----
  val ended = Set("refunded", "kept").contains(s.row)
  val inboxLinksPayPage = s.row == "needed" or (ended and s.endRead == "fallback")
  val inboxLinksTransaction = ended and s.endRead == "linked"
  action readEnd = all { ended, s.endRead == "idle", s' = s.with("endRead", "loading") }
  action endAnswers = all { s.endRead == "loading",
    s' = s.with("endRead", if (s.fault == "ok") "linked" else "fallback") }

  // ---- The sentence before filing, and the owner's checkbox ----
  val noticeShown = s.switched and s.setting != "off"
  action toggle = s' = s.with("checked", not(s.checked))
  action publish = all { s.checked != (s.setting != "off"), s.revisions < 3,
    s' = s.with("setting", if (s.checked) "on" else "off")
      .with("revisions", s.revisions + 1) }
  // Publishing an unchanged choice is refused as "Nothing changed".
  action publishUnchanged = all { s.checked == (s.setting != "off"), s' = s }

  action step = any { load, retry, routeRecovers, reread, openForm, reviewDeposit, askWallet,
    refuseStale, recordPaid, anotherPayerPays, decide("refund_due"), decide("kept_due"),
    settle, readEnd, endAnswers, toggle, publish, publishUnchanged, s' = s }

  val invariant = all {
    // A wallet is asked only with the deposit on, a case id and a record that matched.
    s.asked implies (s.switched and s.named and s.row != "none"),
    s.formOpen implies (s.switched and s.named),
    s.review implies s.formOpen,
    Set("refused", "not-asked", "bad-address", "loading").contains(s.view)
      implies not(s.formOpen),
    // An address that is not a case id is never looked up.
    not(s.named) implies s.view == "bad-address",
    // A record that did not match is never shown as due or paid.
    s.view == "refused" implies s.fault == "tampered",
    s.view == "paid" implies RECORDED.contains(s.row),
    // A report another payer paid before this tab asked is never paid from it.
    s.paidElsewhere implies not(s.asked),
    // Only "needed" and a failed read of an ended deposit link the pay page;
    // only an ended deposit links a transaction, and only it reads the record.
    inboxLinksTransaction implies ended,
    s.endRead != "idle" implies ended,
    not(inboxLinksPayPage and inboxLinksTransaction),
    // The sentence needs both the switch and the project's setting.
    noticeShown implies (s.switched and s.setting != "off"),
    // A project that never set it records a setting only by turning it off first.
    s.revisions == 0 implies s.setting == s.initial,
    (s.initial == "absent" and s.setting == "on") implies s.revisions >= 2,
    s.setting == "absent" implies s.revisions == 0,
    s.revisions <= 3
  }

  run payTest = start(true, "absent", "needed", "ok", true).then(load)
    .expect(payable and noticeShown and inboxLinksPayPage)
    .then(openForm).then(reviewDeposit).then(askWallet).expect(s.asked)
    .then(recordPaid).then(reread).expect(s.view == "paid" and not(payable))
    .then(decide("refund_due")).then(settle).expect(s.row == "refunded")
    .then(readEnd).then(endAnswers).expect(inboxLinksTransaction and not(inboxLinksPayPage))
  run switchedOffTest = start(false, "absent", "needed", "ok", true).then(load)
    .expect(s.view == "due" and not(payable) and not(noticeShown))
    .then(openForm.fail())
  run switchedOffStillShowsEndTest = start(false, "absent", "kept", "ok", true).then(load)
    .expect(s.view == "paid" and not(payable))
  run tamperedRecordTest = start(true, "absent", "needed", "tampered", true).then(load)
    .expect(s.view == "refused" and not(payable)).then(openForm.fail())
  run notAskedTest = start(true, "absent", "none", "ok", true).then(load)
    .expect(s.view == "not-asked" and not(payable) and not(inboxLinksPayPage))
  run badAddressTest = start(true, "absent", "needed", "ok", false)
    .expect(s.view == "bad-address").then(load.fail())
  run unreachableThenRetryTest = start(true, "absent", "needed", "unreachable", true).then(load)
    .expect(s.view == "error" and not(payable)).then(routeRecovers).then(retry).then(load)
    .expect(payable)
  run paidElsewhereTest = start(true, "absent", "needed", "ok", true).then(load).then(openForm)
    .then(reviewDeposit).then(anotherPayerPays).then(refuseStale)
    .expect(not(s.asked) and s.view == "paid" and not(s.review))
  run paidElsewhereNeverAsksTest = start(true, "absent", "needed", "ok", true).then(load)
    .then(openForm).then(reviewDeposit).then(anotherPayerPays).then(askWallet.fail())
  run endReadFailsTest = start(true, "absent", "kept", "unreachable", true).then(readEnd)
    .then(endAnswers).expect(inboxLinksPayPage and not(inboxLinksTransaction))
  run recordedReadsNothingTest = start(true, "absent", "paid", "ok", true).then(readEnd.fail())
  run ownerTurnsOffAndOnTest = start(true, "absent", "needed", "ok", true)
    .expect(s.checked and noticeShown).then(publishUnchanged)
    .expect(s.revisions == 0 and s.setting == "absent")
    .then(toggle).then(publish).expect(s.setting == "off" and not(noticeShown))
    .then(toggle).then(publish).expect(s.setting == "on" and s.revisions == 2 and noticeShown)
  run turnedOffProjectTest = start(true, "off", "none", "ok", true)
    .expect(not(s.checked) and not(noticeShown)).then(publish.fail())
}

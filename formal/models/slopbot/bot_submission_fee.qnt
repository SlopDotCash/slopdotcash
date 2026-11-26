// @source workers/slopbot/submission-fee.ts
// @source workers/slopbot/review.ts
// @source workers/slopbot/review-cap.ts
// @source workers/slopbot/ready-label.ts
// @source workers/slopbot/index.ts
// @source workers/slopbot/appeals.ts
// @source src/lib/submission-fee.mjs
// @source src/lib/submission-fee-setting.mjs
// @source src/lib/wanted-label.mjs
// @source migrations/0141_submission_fee_items.sql
// @source migrations/0142_slopbot_fee_gates.sql
// @evidence workers/slopbot/submission-fee.test.ts
// The refundable submission fee (operator decision, 18 November 2026; PRD
// section 5). One pull request of one project. While the owner's setting is
// on and the switch is live, Slopbot's first sight of an outside
// contributor's pull request inserts the item row, posts one comment, adds
// the fee-needed label and skips the review. The submission-fee Worker marks
// the row paid; the fee check then swaps the label and the held review runs.
// The check sets refund_due when the pull request is merged or still open
// REFUND_AFTER days after payment, and kept_due when it has stayed closed
// without a merge for KEPT_AFTER days. Slopbot has no action that closes a
// pull request or moves money, and a maintainer can merge an unpaid one.
// REFUND_AFTER and KEPT_AFTER abstract 14 and 7 days. A switch that is live
// with no published deposit contract behaves as "off" and is modelled so.
// The first ask is two writes (GitHub, then D1) under a lease, so a job can
// die between them; `holder` is a job that holds the lease. A job whose
// GitHub write fails gives the lease back, so `holderDies` is also that
// failure and the queue's retry is the next review delivery. The Worker may
// withdraw a payment whose deposit a chain reorganisation removed, while no
// outcome is set; the next check then asks again. Taking an unpaid ask back
// removes its row, so a deposit sent afterwards pays for nothing.
// Wanted work (operator decision, 22 November 2026): `wanted` is a pull
// request that closes an issue labelled `slop-wanted` before it was opened,
// fixed at opening. Closed without a merge it is refund_due after KEPT_AFTER
// unless a maintainer added `slop-keep-fee` by then; a label added after
// then, including a re-add after a removal, does not keep it. A failed
// GitHub read decides nothing.
// Slopbot may itself close the pull request for a finding, and its author may
// appeal that close. While the appeal is undecided no fee is kept; a denied
// appeal leaves the close standing, and an upheld one reopens the pull request
// and starts the KEPT_AFTER wait again. An appeal opened or upheld after
// kept_due is written puts the outcome back to none, but only while the
// resolver Worker has recorded no send for the deposit. The Worker reads the
// outcome (`workerPlans`), signs and records its send (`workerSends`) without
// reading it again, and the finalized Resolved event sets `kept`; so a clear
// that lands between its read and its record loses the race and the chain's
// record wins.
module bot_submission_fee {
  pure val REFUND_AFTER = 2
  pure val KEPT_AFTER = 2
  pure val MAX_PUSHES = 1
  var s: {
    mode: str,          // off, dry, live
    leftLive: bool,     // the switch was live and then changed
    everLive: bool,
    settingOn: bool, opened: bool, outsider: bool, openedAfter: bool,
    pr: str,            // open, closed, merged
    pushes: int, reviewed: bool, ready: bool,
    gate: str,          // none, recorded, asking, asked, paid, released
    holder: bool,
    row: bool, paid: bool, everPaid: bool,
    outcome: str,       // none, refund_due, kept_due, kept
    label: str,         // none, needed, paid
    comments: int,
    paidDays: int, closedDays: int,
    everMerged: bool, openAtRefundAge: bool, closedAtKeptAge: bool,
    wanted: bool, keepMark: bool, keepMarkLate: bool,
    decidedWithTimelyMark: bool,
    slopClosed: bool,
    appeal: str,        // none, open, upheld, denied
    planned: bool, sent: bool, clearedWhileSent: bool
  }
  action init = s' = {
    mode: "off", leftLive: false, everLive: false,
    settingOn: false, opened: false, outsider: true, openedAfter: false,
    pr: "open", pushes: 0, reviewed: false, ready: false,
    gate: "none", holder: false, row: false, paid: false, everPaid: false,
    outcome: "none",
    label: "none", comments: 0, paidDays: 0, closedDays: 0,
    everMerged: false, openAtRefundAge: false, closedAtKeptAge: false,
    wanted: false, keepMark: false, keepMarkLate: false,
    decidedWithTimelyMark: false,
    slopClosed: false, appeal: "none",
    planned: false, sent: false, clearedWhileSent: false
  }
  val applies = all { s.settingOn, s.outsider, s.openedAfter }
  val unpaidAsk = (s.gate == "asking" or s.gate == "asked") and not(s.paid)
  // An ask that can be taken back: finished, or left by a job that died.
  val askStands = s.gate == "asked" or (s.gate == "asking" and not(s.holder))
  def released(state) = state.with("gate", "released").with("label", "none")
    .with("comments", 1).with("row", false)

  // --- The owner, the operator, the contributor and maintainers.
  action setMode(wanted: str): bool = all { wanted != s.mode,
    s' = s.with("mode", wanted).with("everLive", s.everLive or wanted == "live")
      .with("leftLive", s.leftLive or s.mode == "live") }
  action operatorSetsMode = {
    nondet wanted = Set("off", "dry", "live").oneOf()
    setMode(wanted)
  }
  // Turned on after the pull request was opened, the fee does not apply to it.
  action ownerTurnsOn = all { not(s.settingOn),
    s' = s.with("settingOn", true).with("openedAfter", false) }
  action ownerTurnsOff = all { s.settingOn, s' = s.with("settingOn", false) }
  action opensFor(outside: bool, invited: bool): bool = all { not(s.opened),
    s' = s.with("opened", true).with("outsider", outside)
      .with("openedAfter", s.settingOn).with("wanted", invited) }
  action opens(outside: bool): bool = opensFor(outside, false)
  action contributorOpens = {
    nondet outside = Set(true, false).oneOf()
    nondet invited = Set(true, false).oneOf()
    opensFor(outside, invited)
  }
  // Only a maintainer can label a pull request on GitHub.
  action maintainerMarksKeep = all { s.opened, s.outcome == "none",
    s' = s.with("keepMark", true).with("keepMarkLate", s.closedAtKeptAge) }
  action maintainerUnmarksKeep = all { s.keepMark, s.outcome == "none",
    s' = s.with("keepMark", false).with("keepMarkLate", false) }
  action authorGainsAccess = all { s.opened, s.outsider,
    s' = s.with("outsider", false) }
  action push = all { s.opened, s.pr == "open", s.pushes < MAX_PUSHES,
    s' = s.with("pushes", s.pushes + 1).with("reviewed", false)
      .with("ready", false) }
  // A maintainer may merge whether or not a fee was paid.
  action maintainerMerges = all { s.opened, s.pr == "open",
    s' = s.with("pr", "merged").with("everMerged", true) }
  action closes = all { s.opened, s.pr == "open",
    s' = s.with("pr", "closed").with("closedDays", 0).with("slopClosed", false)
      .with("keepMarkLate", false) }
  action slopbotCloses = all { s.opened, s.pr == "open",
    s' = s.with("pr", "closed").with("closedDays", 0).with("slopClosed", true)
      .with("appeal", "none").with("keepMarkLate", false) }
  def reopenKept(state) = if (state.outcome == "kept_due" and not(state.sent))
      state.with("outcome", "none").with("clearedWhileSent", state.clearedWhileSent or state.sent)
    else state
  action authorAppeals = all { s.pr == "closed", s.slopClosed,
    s.appeal == "none", s' = reopenKept(s.with("appeal", "open")) }
  action moderatorDenies = all { s.appeal == "open",
    s' = s.with("appeal", "denied") }
  // The restarted wait matters only to an undecided outcome; a fee already
  // sent stays kept at the age it was kept.
  def upheld(state) = {
    val result = reopenKept(state.with("appeal", "upheld").with("closedDays", 0))
    result.with("closedAtKeptAge",
      if (result.outcome == "none") false else state.closedAtKeptAge)
      .with("keepMarkLate",
        if (result.outcome == "none") false else state.keepMarkLate)
  }
  action moderatorUpholds = all { s.appeal == "open", s' = upheld(s) }
  action workerPlans = all { s.outcome == "kept_due", not(s.sent),
    s' = s.with("planned", true) }
  action workerSends = all { s.planned, not(s.sent), s' = s.with("sent", true) }
  action workerFinalizes = all { s.sent, s.outcome != "kept",
    s' = s.with("outcome", "kept") }
  // A pull request reopened past the refund age is open at that age at once.
  action reopens = all { s.pr == "closed",
    s' = s.with("pr", "open").with("closedDays", 0).with("keepMarkLate", false)
      .with("openAtRefundAge", s.openAtRefundAge
        or (s.paid and s.paidDays >= REFUND_AFTER)) }
  // The submission-fee Worker accepts a deposit for a row Slopbot inserted.
  // It marks only an undecided row, and may withdraw the mark while no
  // outcome is set.
  action workerMarksPaid = all { s.row, not(s.paid), s.outcome == "none",
    s' = s.with("paid", true).with("everPaid", true).with("paidDays", 0)
      .with("closedDays", 0).with("keepMarkLate", false) }
  // The resolver plans only a finalized deposit, which no reorganisation can
  // withdraw.
  action workerWithdrawsPayment = all { s.paid, s.outcome == "none", not(s.planned),
    s' = s.with("paid", false) }
  val nextPaidDays = if (s.paidDays < REFUND_AFTER) s.paidDays + 1 else s.paidDays
  val nextClosedDays = if (s.pr == "closed" and s.closedDays < KEPT_AFTER)
    s.closedDays + 1 else s.closedDays
  action dayPasses = all { s.paid,
    s' = s.with("paidDays", nextPaidDays).with("closedDays", nextClosedDays)
      .with("openAtRefundAge", s.openAtRefundAge
        or (s.pr == "open" and nextPaidDays >= REFUND_AFTER))
      .with("closedAtKeptAge", s.closedAtKeptAge
        or (s.pr == "closed" and nextClosedDays >= KEPT_AFTER)) }

  // --- Slopbot. One review delivery for an open pull request that has no
  // completed review at its head. `monthOpen` is the monthly cap peek.
  // Record-only writes Slopbot's own gate and no row: nobody was asked, so
  // the Worker has nothing to mark paid.
  val recordedOnly = (if (applies and not(s.row) and s.gate == "none")
      s.with("gate", "recorded")
    else s).with("reviewed", true)
  action review(monthOpen: bool): bool = all { s.opened, s.pr == "open",
    not(s.reviewed),
    if (s.mode == "off") s' = s.with("reviewed", true)
    // Record what would be asked; the review runs as today. A review the
    // monthly cap refuses is not asked live, so nothing is recorded for it.
    else if (s.mode == "dry") s' = (if (monthOpen) recordedOnly else s)
    else if (s.paid) s' = s.with("reviewed", true)
    // Exempt: an earlier ask is taken back; the author is not reviewed.
    else if (not(s.outsider)) s' = (if (askStands) released(s) else s)
    else if (not(applies))
      s' = (if (askStands and not(s.settingOn)) released(s).with("reviewed", true)
        else if (unpaidAsk) s
        else s.with("reviewed", true))
    // A paid mark whose payment was withdrawn waits again.
    else if (s.gate == "asked" or s.gate == "paid"
      or (s.gate == "asking" and s.holder)) s' = s
    else if (not(monthOpen)) s' = s
    // First sight: take the lease and insert the row.
    else s' = s.with("gate", "asking").with("holder", true).with("row", true)
  }
  action reviewDelivery = {
    nondet monthOpen = Set(true, false).oneOf()
    review(monthOpen)
  }
  // The comment is found by the App's own account first, so a retake after a
  // crash updates it instead of posting a second one.
  action askPosts = all { s.holder, s.gate == "asking",
    s' = s.with("comments", 1).with("label", "needed") }
  action askRecords = all { s.holder, s.gate == "asking", s.label == "needed",
    s' = s.with("gate", "asked").with("holder", false) }
  action holderDies = all { s.holder, s' = s.with("holder", false) }
  // The scheduled or event-driven check of an asked pull request.
  val dueOutcome = if (s.outcome != "none") s.outcome
    else if (s.pr == "merged") "refund_due"
    else if (s.pr == "closed" and s.appeal != "open" and s.closedDays >= KEPT_AFTER)
      (if (s.wanted and (not(s.keepMark) or s.keepMarkLate)) "refund_due"
        else "kept_due")
    else if (s.pr == "open" and s.paidDays >= REFUND_AFTER) "refund_due"
    else "none"
  // A closed wanted pull request whose link GitHub could not answer waits.
  action check(readable: bool): bool = all { s.mode == "live", s.row, s.gate != "none",
    not(s.gate == "asking" and s.holder),
    if (not(s.paid))
      s' = (if (askStands and not(s.settingOn)) released(s)
        // The payment was withdrawn: the label and comment ask again.
        else if (s.gate == "paid") s.with("gate", "asked").with("label",
          if (s.pr == "open") "needed" else "none")
        else s)
    else s' = s.with("gate", "paid").with("label", "paid").with("comments", 1)
      .with("outcome", if (not(readable) and s.pr == "closed" and s.outcome == "none")
        "none" else dueOutcome)
      .with("decidedWithTimelyMark",
        if (s.outcome == "none") (s.keepMark and not(s.keepMarkLate))
        else s.decidedWithTimelyMark)
  }
  action feeCheck = check(true)
  action feeCheckUnreadable = check(false)
  // The ready label needs a completed review of the head and never goes on a
  // pull request whose fee is asked and unpaid.
  action readyCheck = all { s.opened, s.pr == "open",
    s' = s.with("ready", s.reviewed and not(s.mode == "live" and unpaidAsk)) }

  action step = any { operatorSetsMode, ownerTurnsOn, ownerTurnsOff,
    contributorOpens, authorGainsAccess, push, maintainerMerges, closes,
    slopbotCloses, authorAppeals, moderatorDenies, moderatorUpholds, reopens,
    workerPlans, workerSends, workerFinalizes, workerMarksPaid,
    workerWithdrawsPayment, dayPasses, reviewDelivery, askPosts, askRecords,
    holderDies, feeCheck, feeCheckUnreadable, readyCheck, maintainerMarksKeep,
    maintainerUnmarksKeep, s' = s }

  val invariant = all {
    // One comment at most, whatever crashes or retries.
    s.comments <= 1,
    s.label == "needed" implies (s.gate == "asking" or s.gate == "asked"),
    s.gate == "asked" implies (s.row and s.comments == 1),
    (s.gate == "asked" and not(s.everPaid)) implies s.label == "needed",
    s.gate == "paid" implies (s.label == "paid" and s.everPaid),
    // Slopbot only sets an outcome on a paid row, and only when it is due.
    s.outcome != "none" implies (s.paid and s.gate == "paid"),
    s.outcome == "kept_due" implies s.closedAtKeptAge,
    // No fee is kept for Slopbot's own close while its appeal is undecided,
    // unless the Worker had already recorded its send.
    (s.outcome == "kept_due" and s.appeal == "open") implies s.sent,
    // A recorded send is never cleared.
    not(s.clearedWhileSent),
    // Invited work is kept only on a maintainer's timely mark.
    s.keepMarkLate implies s.keepMark,
    (s.outcome == "kept_due" and s.wanted) implies s.decidedWithTimelyMark,
    s.outcome == "refund_due" implies (s.everMerged or s.openAtRefundAge
      or (s.wanted and s.closedAtKeptAge and not(s.decidedWithTimelyMark))),
    // Off and record-only write nothing to GitHub and decide nothing.
    not(s.everLive) implies all { s.label == "none", s.comments == 0,
      s.gate == "none" or s.gate == "recorded", s.outcome == "none" },
    // A pull request that was only recorded has no row for the Worker to
    // mark paid.
    s.gate == "recorded" implies not(s.row),
    // While the switch stays live, an ask taken back leaves no row for the
    // Worker to mark paid.
    (s.mode == "live" and not(s.leftLive) and s.gate == "released")
      implies not(s.row),
    // While the switch stays live, an asked pull request that was never paid
    // has no review of its head and no ready label.
    (s.mode == "live" and not(s.leftLive) and unpaidAsk and not(s.everPaid))
      implies (not(s.reviewed) and not(s.ready)),
  }

  run firstSightAsksOnceTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(review(true))
    .expect(s.gate == "asked" and s.label == "needed" and s.comments == 1
      and s.row and not(s.reviewed) and s.pr == "open")
  run paidRunsHeldReviewTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(review(true))
    .expect(s.gate == "paid" and s.label == "paid" and s.comments == 1
      and s.reviewed and s.outcome == "none")
  run mergedIsDueBackTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(maintainerMerges).then(feeCheck)
    .expect(s.outcome == "refund_due" and s.pr == "merged")
  run undecidedIsDueBackTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(dayPasses).then(dayPasses)
    .then(feeCheck)
    .expect(s.outcome == "refund_due" and s.pr == "open")
  run undecidedBeforeTheAgeWaitsTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(dayPasses).then(feeCheck)
    .expect(s.outcome == "none")
  run closedIsKeptAfterTheWaitTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(closes).then(dayPasses)
    .then(dayPasses).then(feeCheck)
    .expect(s.outcome == "kept_due" and s.pr == "closed")
  run wantedClosedIsSentBackTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opensFor(true, true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(closes).then(dayPasses)
    .then(dayPasses).then(feeCheck)
    .expect(s.outcome == "refund_due" and s.pr == "closed")
  run wantedMarkedIsKeptTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opensFor(true, true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(closes).then(maintainerMarksKeep)
    .then(dayPasses).then(dayPasses).then(feeCheck)
    .expect(s.outcome == "kept_due" and s.decidedWithTimelyMark)
  run wantedLateMarkIsSentBackTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opensFor(true, true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(closes).then(dayPasses)
    .then(dayPasses).then(maintainerMarksKeep).then(feeCheck)
    .expect(s.outcome == "refund_due" and s.keepMarkLate
      and not(s.decidedWithTimelyMark))
  run wantedUnreadableWaitsTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opensFor(true, true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(closes).then(dayPasses)
    .then(dayPasses).then(feeCheckUnreadable)
    .expect(s.outcome == "none" and s.pr == "closed")
  run reopenedIsNotKeptTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(closes).then(dayPasses)
    .then(reopens).then(feeCheck)
    .expect(s.outcome == "none" and s.pr == "open")
  run appealOfSlopbotCloseHoldsTheFeeTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(askRecords).then(workerMarksPaid).then(feeCheck).then(slopbotCloses)
    .then(authorAppeals).then(dayPasses).then(dayPasses).then(feeCheck)
    .expect(s.outcome == "none" and s.pr == "closed" and s.appeal == "open")
  run upheldAppealReopensAndRefundsTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(askRecords).then(workerMarksPaid).then(feeCheck).then(slopbotCloses)
    .then(authorAppeals).then(dayPasses).then(dayPasses).then(moderatorUpholds)
    .then(feeCheck).then(reopens).then(maintainerMerges).then(feeCheck)
    .expect(s.outcome == "refund_due" and s.pr == "merged")
  run deniedAppealKeepsTheFeeTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(askRecords).then(workerMarksPaid).then(feeCheck).then(slopbotCloses)
    .then(authorAppeals).then(dayPasses).then(dayPasses).then(moderatorDenies)
    .then(feeCheck)
    .expect(s.outcome == "kept_due" and s.pr == "closed")
  run lateAppealBeforeSendReopensTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(askRecords).then(workerMarksPaid).then(feeCheck).then(slopbotCloses)
    .then(dayPasses).then(dayPasses).then(feeCheck).then(authorAppeals)
    .then(moderatorUpholds).then(reopens).then(maintainerMerges).then(feeCheck)
    .expect(s.outcome == "refund_due" and not(s.sent))
  run lateAppealAfterSendKeepsTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(askRecords).then(workerMarksPaid).then(feeCheck).then(slopbotCloses)
    .then(dayPasses).then(dayPasses).then(feeCheck).then(workerPlans)
    .then(workerSends).then(authorAppeals)
    .expect(s.outcome == "kept_due" and s.appeal == "open")
  run clearInsideTheWorkerRaceEndsKeptTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(askRecords).then(workerMarksPaid).then(feeCheck).then(slopbotCloses)
    .then(dayPasses).then(dayPasses).then(feeCheck).then(workerPlans)
    .then(authorAppeals).then(workerSends).then(workerFinalizes)
    .expect(s.outcome == "kept" and s.sent)
  run unpaidMergeHasNothingDueTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(maintainerMerges).then(feeCheck)
    .expect(s.pr == "merged" and s.outcome == "none" and not(s.paid))
  run exemptAuthorIsNeverAskedTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(false)).then(review(true))
    .expect(s.gate == "none" and not(s.row) and s.comments == 0)
  run openedBeforeTheSettingIsReviewedTest = init.then(setMode("live"))
    .then(opens(true)).then(ownerTurnsOn).then(review(true))
    .expect(s.reviewed and s.gate == "none" and not(s.row))
  run settingOffIsReviewedTest = init.then(setMode("live")).then(opens(true))
    .then(review(true))
    .expect(s.reviewed and s.gate == "none" and s.label == "none")
  run offDoesNothingTest = init.then(ownerTurnsOn).then(opens(true))
    .then(review(true))
    .expect(s.reviewed and s.gate == "none" and not(s.row) and s.label == "none")
  run dryRunRecordsAndReviewsTest = init.then(ownerTurnsOn).then(setMode("dry"))
    .then(opens(true)).then(review(true))
    .expect(s.gate == "recorded" and not(s.row) and s.reviewed and s.label == "none"
      and s.comments == 0)
  run settingTurnedOffReleasesTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(ownerTurnsOff).then(feeCheck).then(review(true))
    .expect(s.gate == "released" and s.label == "none" and s.reviewed
      and not(s.row))
  run authorGainingAccessReleasesTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(authorGainsAccess).then(review(true))
    .expect(s.gate == "released" and s.label == "none" and not(s.reviewed)
      and not(s.row))
  run crashDoesNotDuplicateTheCommentTest = init.then(ownerTurnsOn)
    .then(setMode("live")).then(opens(true)).then(review(true)).then(askPosts)
    .then(holderDies).then(review(true)).then(askPosts).then(askRecords)
    .expect(s.comments == 1 and s.gate == "asked")
  run fullMonthIsNotAskedTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(false))
    .expect(s.gate == "none" and not(s.row) and s.comments == 0)
  run fullMonthIsNotRecordedInDryRunTest = init.then(ownerTurnsOn)
    .then(setMode("dry")).then(opens(true)).then(review(false))
    .expect(s.gate == "none" and not(s.row) and s.comments == 0)
  run withdrawnPaymentAsksAgainTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(workerMarksPaid).then(feeCheck).then(workerWithdrawsPayment)
    .then(feeCheck).then(push).then(review(true))
    .expect(s.gate == "asked" and s.label == "needed" and not(s.reviewed)
      and s.outcome == "none")
  run unpaidIsNeverReadyTest = init.then(ownerTurnsOn).then(setMode("live"))
    .then(opens(true)).then(review(true)).then(askPosts).then(askRecords)
    .then(readyCheck)
    .expect(not(s.ready))
}

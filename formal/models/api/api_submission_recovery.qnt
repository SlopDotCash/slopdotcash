// @source backend/security/submissions.ts
// @source backend/security/submission-store.ts
// @source backend/security/report-intake.ts
// @source backend/security/verified-intake.ts
// @source migrations/0059_private_security_submissions.sql
// @source migrations/0101_durable_security_intake.sql
// @evidence backend/security/submissions.test.ts
// One Slop-origin submission, two sender slots/committed attempts, at most two
// external copies and twelve revisions. The saved case, if any, is retained.
// Sender slots keep distinct CAS inputs, committed claim revisions and actual
// readback observations. A successful batch is not a successful readback; lost
// replies and missing changes metadata leave committed rows/events intact.
// transition returns only its exact next revision/state. The old unchecked
// readback action is an explicit negative control outside step.
// Actor/session, grant, repository, report bytes and receipt-facts validation
// are successful captured preconditions here, not continuous global authority.
// Ban and durable intake revision are represented at the atomic send claim.
// Age classes0=start,1=exactly60s,2=>60s,3=<300s,4=>=300s,5=>24h retain the
// source strict/non-strict boundaries. Idle expiry is an independent predicate.
// The grant's own expiry is not a send lease. A validated readback is also not
// an atomic fence against changes before an external POST starts; no such
// new policy or transaction is asserted. Completion still uses its own claim.
// Copies may appear after an empty listing. A successful retry listing selects
// the earliest visible copy; a failed listing keeps the accepted new copy.
// Copy ordering abstracts created_at plus GHSA tie-breaking, not attempt order.
// Reconciliation and verified-case writes are atomic outcome projections here;
// their own in-flight reads, full advisory validation and role checks are out
// of scope. Legacy/direct creation and OAuth cookies are in adjacent models.
// Case creation/linking remains atomic with the receipt transition. Missing
// receipt responses cannot remove it. This is not an exactly-once POST proof.
// All scenario definitions are source-authored and unexecuted.
module api_submission_recovery {
  val ids = Set(1, 2)
  val replies = Set("ok", "missing-count", "lost")
  type Sender = { phase: str, readRevision: int, readState: str, gateRevision: int,
    claimRevision: int, attempt: int, usableRevision: int, usableState: str,
    matched: bool, posted: bool, outcome: str, chosen: int, nextState: str,
    nextRevision: int, fallbackRevision: int, response: str }
  val idle: Sender = { phase: "unused", readRevision: 0, readState: "none", gateRevision: 0,
    claimRevision: 0, attempt: 0, usableRevision: 0, usableState: "none", matched: false,
    posted: false, outcome: "none", chosen: 0, nextState: "none", nextRevision: 0, fallbackRevision: 0, response: "none" }
  var s: { phase: str, revision: int, attempts: int, age: int, idleExpired: bool,
    copies: Set[int], posts: Set[int], advisory: int, terminalFailure: bool,
    saved: bool, caseCount: int, receiptVerified: bool, contactsVerified: bool,
    absenceObserved: bool, banned: bool, gateRevision: int, senders: int -> Sender,
    receiptReplyLost: bool, firstCopy: int }
  action init = s' = { phase: "draft", revision: 1, attempts: 0, age: 0,
    idleExpired: false, copies: Set(), posts: Set(), advisory: 0, terminalFailure: false,
    saved: false, caseCount: 0, receiptVerified: false, contactsVerified: false,
    absenceObserved: false, banned: false, gateRevision: 1,
    senders: ids.mapBy(_ => idle), receiptReplyLost: false, firstCopy: 1 }
  def end(sender: Sender, response: str): Sender = sender.with("phase", "done").with("response", response)
  val earliest = if (s.copies == ids) s.firstCopy else if (s.copies.contains(1)) 1 else 2
  action reverseCopyOrder = all { s.copies == Set(), s.advisory == 0, s.firstCopy == 1,
    s' = s.with("firstCopy", 2) }
  action save = all { s.phase == "draft", s.attempts == 0,
    s' = s.with("saved", true).with("caseCount", 1) }
  action ban = s' = s.with("banned", true)
  action changeGate = all { s.gateRevision == 1, s' = s.with("gateRevision", 2) }
  action read(id: int): bool = {
    val sender = s.senders.get(id)
    all { ids.contains(id), Set("unused", "read").contains(sender.phase),
      s' = s.with("senders", s.senders.set(id, sender.with("phase", "read")
        .with("readRevision", s.revision).with("readState", s.phase).with("gateRevision", s.gateRevision))) }
  }
  action claimSend(id: int): bool = {
    val sender = s.senders.get(id)
    val matches = sender.readRevision == s.revision and sender.readState == s.phase
      and (not(s.saved) or sender.gateRevision == s.gateRevision) and not(s.banned)
    all { sender.phase == "read", s.revision < 12, s.attempts < 2,
      Set("draft", "failed").contains(sender.readState), not(s.terminalFailure), s.advisory == 0,
      s' = if (not(matches)) s.with("senders", s.senders.set(id, end(sender, "stale")))
      else s.with("phase", "submitting").with("revision", s.revision + 1).with("attempts", s.attempts + 1)
        .with("age", 0).with("idleExpired", false).with("absenceObserved", false)
        .with("senders", s.senders.set(id, sender.with("phase", "claim-reply")
          .with("claimRevision", s.revision + 1).with("attempt", s.attempts + 1))) }
  }
  action claimReply(id: int, reply: str): bool = {
    val sender = s.senders.get(id)
    all { sender.phase == "claim-reply", replies.contains(reply),
      s' = s.with("senders", s.senders.set(id, if (reply == "ok") sender.with("phase", "claim-readback")
        else end(sender, if (reply == "lost") "error" else "stale"))) }
  }
  action claimReadback(id: int, present: bool): bool = {
    val sender = s.senders.get(id)
    val matches = present and s.revision == sender.claimRevision and s.phase == "submitting"
    all { sender.phase == "claim-readback",
      s' = s.with("senders", s.senders.set(id, if (matches) sender.with("phase", "ready").with("matched", true)
        .with("usableRevision", s.revision).with("usableState", s.phase) else end(sender, "stale"))) }
  }
  // Former transition return of any current row, deliberately excluded from step.
  action legacyClaimReadback(id: int): bool = {
    val sender = s.senders.get(id)
    all { sender.phase == "claim-readback", s' = s.with("senders", s.senders.set(id,
      sender.with("phase", "ready").with("usableRevision", s.revision).with("usableState", s.phase)
        .with("matched", s.revision == sender.claimRevision and s.phase == "submitting"))) }
  }
  action providerStart(id: int): bool = {
    val sender = s.senders.get(id)
    all { sender.phase == "ready", s' = s.with("posts", s.posts.union(Set(sender.attempt)))
      .with("senders", s.senders.set(id, sender.with("phase", "provider").with("posted", true))) }
  }
  action land(copy: int): bool = all { ids.contains(copy), s.posts.contains(copy),
    ids.exists(id => s.senders.get(id).attempt == copy and s.senders.get(id).posted
      and not(Set("terminal", "retryable", "throttled").contains(s.senders.get(id).outcome))),
    s' = s.with("copies", s.copies.union(Set(copy))) }
  action providerResult(id: int, outcome: str, listingOk: bool): bool = {
    val sender = s.senders.get(id)
    val nextPhase = if (outcome == "created") "submitted" else if (outcome == "uncertain") "uncertain"
      else if (outcome == "throttled") "draft" else "failed"
    val chosen = if (outcome != "created") 0 else if (sender.attempt > 1 and listingOk) earliest else sender.attempt
    all { sender.phase == "provider", Set("created", "uncertain", "throttled", "terminal", "retryable").contains(outcome),
      outcome == "created" implies s.copies.contains(sender.attempt),
      Set("terminal", "retryable", "throttled").contains(outcome) implies not(s.copies.contains(sender.attempt)),
      s' = s.with("senders", s.senders.set(id, sender.with("phase", "outcome-write")
        .with("outcome", outcome).with("nextState", nextPhase).with("chosen", chosen))) }
  }
  action commitOutcome(id: int): bool = {
    val sender = s.senders.get(id)
    val matches = s.revision == sender.usableRevision and s.phase == sender.usableState
    all { sender.phase == "outcome-write", s.revision < 12,
      s' = if (not(matches)) s.with("senders", s.senders.set(id,
        if (sender.outcome == "created") sender.with("phase", "accepted-fallback") else end(sender, "fallback")))
      else s.with("phase", sender.nextState).with("revision", s.revision + 1).with("idleExpired", false)
        .with("terminalFailure", sender.outcome == "terminal")
        .with("advisory", if (sender.outcome == "created") sender.chosen else s.advisory)
        .with("senders", s.senders.set(id, sender.with("phase", "outcome-reply").with("nextRevision", s.revision + 1))) }
  }
  action outcomeReply(id: int, reply: str): bool = {
    val sender = s.senders.get(id)
    all { sender.phase == "outcome-reply", replies.contains(reply),
      s' = s.with("senders", s.senders.set(id, if (reply == "ok") sender.with("phase", "outcome-readback")
        else end(sender, if (reply == "lost") "error" else "fallback"))) }
  }
  action outcomeReadback(id: int, present: bool): bool = {
    val sender = s.senders.get(id)
    all { sender.phase == "outcome-readback", s' = s.with("senders", s.senders.set(id,
      end(sender, if (present and s.revision == sender.nextRevision and s.phase == sender.nextState) "own-outcome" else "fallback"))) }
  }
  // A stale accepted reply never resends. Source reads the current row and
  // may mark a still-submitting claim uncertain, then returns a fresh view.
  action fallbackRead(id: int): bool = {
    val sender = s.senders.get(id)
    all { sender.phase == "accepted-fallback", s' = s.with("senders", s.senders.set(id,
      if (s.phase == "submitting") sender.with("phase", "fallback-write").with("fallbackRevision", s.revision)
      else end(sender, "fallback"))) }
  }
  action fallbackWrite(id: int): bool = {
    val sender = s.senders.get(id)
    val matches = s.phase == "submitting" and s.revision == sender.fallbackRevision
    all { sender.phase == "fallback-write", s.revision < 12,
      s' = s.with("phase", if (matches) "uncertain" else s.phase)
        .with("revision", if (matches) s.revision + 1 else s.revision)
        .with("senders", s.senders.set(id, end(sender, "fallback"))) }
  }
  action age = all { s.attempts > 0, s.age < 5, s' = s.with("age", s.age + 1) }
  action idleExpires = s' = s.with("idleExpired", true)
  action interrupted = all { s.phase == "submitting", s.age >= 2, s.revision < 12,
    s' = s.with("phase", "uncertain").with("revision", s.revision + 1).with("idleExpired", false) }
  action reconcileFound = all { s.phase == "uncertain", s.advisory == 0, s.copies.size() > 0, s.revision < 12,
    s' = s.with("phase", "submitted").with("advisory", earliest).with("revision", s.revision + 1) }
  action reconcileEmpty = all { s.phase == "uncertain", s.advisory == 0, s.copies.size() == 0, s.age >= 4, s.revision < 12,
    s' = s.with("phase", "draft").with("revision", s.revision + 1).with("absenceObserved", true).with("idleExpired", false) }
  action reconcileInconclusive = all { s.phase == "uncertain", s.revision < 12,
    s' = s.with("revision", s.revision + 1) }
  action contactsUnavailable = all { s.phase == "submitted", s.advisory != 0, s.revision < 12,
    s' = s.with("contactsVerified", true).with("revision", s.revision + 1) }
  action verify = all { s.phase == "submitted", s.advisory != 0, s.revision < 12,
    s' = s.with("phase", "receipt-verified").with("revision", s.revision + 1)
      .with("receiptVerified", true).with("caseCount", 1) }
  action loseReceiptReply = all { s.receiptVerified, s' = s.with("receiptReplyLost", true) }
  action verificationExpires = all { s.phase == "submitted", s.age == 5, not(s.contactsVerified), s.revision < 12,
    s' = s.with("phase", "failed").with("terminalFailure", true).with("revision", s.revision + 1).with("idleExpired", false) }
  action abandon = all { Set("draft", "failed").contains(s.phase), s.idleExpired, not(s.saved), s.revision < 12,
    s' = s.with("phase", "abandoned").with("revision", s.revision + 1) }
  action step = {
    nondet id = ids.oneOf()
    nondet reply = replies.oneOf()
    nondet outcome = Set("created", "uncertain", "throttled", "terminal", "retryable").oneOf()
    nondet yes = Set(false, true).oneOf()
    any { save, ban, changeGate, reverseCopyOrder, read(id), claimSend(id), claimReply(id, reply), claimReadback(id, yes), providerStart(id), land(id),
      providerResult(id, outcome, yes), commitOutcome(id), outcomeReply(id, reply), outcomeReadback(id, yes), age, idleExpires,
      fallbackRead(id), fallbackWrite(id),
      interrupted, reconcileFound, reconcileEmpty, reconcileInconclusive, contactsUnavailable, verify, loseReceiptReply,
      verificationExpires, abandon, s' = s }
  }
  val ownClaimOnly = ids.forall(id => {
    val sender = s.senders.get(id)
    sender.posted implies sender.matched and sender.usableRevision == sender.claimRevision and sender.usableState == "submitting"
  })
  val invariant = all { ownClaimOnly, s.attempts <= 2, s.revision <= 12, s.caseCount <= 1,
    s.saved implies s.caseCount == 1 and s.phase != "abandoned",
    s.receiptVerified implies s.phase == "receipt-verified" and s.advisory != 0 and s.caseCount == 1,
    s.advisory != 0 implies s.copies.contains(s.advisory), s.copies.subseteq(s.posts),
    s.posts.subseteq(ids), s.posts.size() == ids.filter(id => s.senders.get(id).posted).size() }
  action committed(id: int): bool = read(id).then(claimSend(id))
  action ready(id: int): bool = committed(id).then(claimReply(id, "ok")).then(claimReadback(id, true))
  action started(id: int): bool = ready(id).then(providerStart(id))
  action written(id: int): bool = commitOutcome(id).then(outcomeReply(id, "ok")).then(outcomeReadback(id, true))
  action uncertain(id: int): bool = providerResult(id, "uncertain", true).then(written(id))
  action fourTicks = age.then(age).then(age).then(age)
  action fiveTicks = fourTicks.then(age)
  action heldClaim = committed(1).then(claimReply(1, "ok")).then(age).then(age).then(interrupted)
  action heldThenDraft = heldClaim.then(age).then(age).then(reconcileEmpty)

  run competingSendCannotUseOldRevisionTest = init.then(read(1)).then(read(2)).then(claimSend(1)).then(claimSend(2))
    .expect(s.senders.get(2).response == "stale" and s.attempts == 1 and invariant)
  run interruptWinsOverLateReceiptTest = init.then(save).then(started(1)).then(age).then(age).then(interrupted).then(land(1))
    .then(providerResult(1, "created", true)).then(commitOutcome(1)).then(fallbackRead(1))
    .expect(s.advisory == 0 and s.senders.get(1).response == "fallback")
    .then(reconcileFound).then(verify).expect(s.receiptVerified and s.caseCount == 1 and invariant)
  run earlyEmptyCannotRetryTest = init.then(started(1)).then(uncertain(1)).then(age).then(age).then(age).then(reconcileEmpty.fail())
  run lateCopyWinsAfterEmptyRetryTest = init.then(started(1)).then(uncertain(1)).then(fourTicks).then(reconcileEmpty)
    .then(started(2)).then(land(1)).then(land(2)).then(providerResult(2, "created", true)).then(written(2)).then(verify)
    .expect(s.advisory == 1 and s.attempts == 2 and s.caseCount == 1 and invariant)
  run verifiedContactsKeepSubmittedRecoveryTest = init.then(started(1)).then(land(1)).then(providerResult(1, "created", true))
    .then(written(1)).then(contactsUnavailable).then(fiveTicks).then(verificationExpires.fail())
  run savedFailureNeverExpiresAwayTest = init.then(save).then(started(1)).then(providerResult(1, "terminal", true))
    .then(written(1)).then(idleExpires).then(abandon.fail())
  run optionalDraftExpiresTest = init.then(idleExpires).then(abandon).expect(s.phase == "abandoned" and s.caseCount == 0 and invariant)
  run delayedReadbackRefusesUncertainRowTest = init.then(heldClaim).then(claimReadback(1, true))
    .expect(s.phase == "uncertain" and s.senders.get(1).response == "stale" and s.posts == Set() and invariant)
  run delayedReadbackRefusesReconciledDraftTest = init.then(heldThenDraft).then(claimReadback(1, true))
    .expect(s.phase == "draft" and s.absenceObserved and s.posts == Set() and invariant)
  run delayedReadbackCannotBorrowNewClaimTest = init.then(heldThenDraft).then(committed(2)).then(claimReadback(1, true))
    .expect(s.phase == "submitting" and s.attempts == 2 and s.posts == Set() and s.senders.get(1).response == "stale" and invariant)
    .then(claimReply(2, "ok")).then(claimReadback(2, true)).then(providerStart(2)).then(land(2))
    .then(providerResult(2, "created", true)).then(written(2)).then(verify).expect(s.posts == Set(2) and s.receiptVerified and invariant)
  run missingClaimCountLeavesCommitButNoPostTest = init.then(committed(1)).then(claimReply(1, "missing-count"))
    .expect(s.phase == "submitting" and s.posts == Set() and invariant)
  run lostClaimReplyRecoversWithoutOldPostTest = init.then(committed(1)).then(claimReply(1, "lost")).then(age).then(age).then(interrupted)
    .then(age).then(age).then(reconcileEmpty).then(started(2)).then(land(2)).then(providerResult(2, "created", true)).then(written(2)).then(verify)
    .expect(s.posts == Set(2) and s.receiptVerified and invariant)
  run missingReadbackRefusesProviderTest = init.then(committed(1)).then(claimReply(1, "ok")).then(claimReadback(1, false))
    .expect(s.posts == Set() and s.phase == "submitting" and invariant)
  run banAtClaimRefusesWithoutMutationTest = init.then(read(1)).then(ban).then(claimSend(1))
    .expect(s.phase == "draft" and s.revision == 1 and s.posts == Set() and invariant)
  run changedStoredReportGateRefusesOldClaimTest = init.then(save).then(read(1)).then(changeGate).then(claimSend(1))
    .expect(s.phase == "draft" and s.attempts == 0 and invariant)
  run validatedReadbackIsNotAtomicWithNetworkTest = init.then(ready(1)).then(age).then(age).then(interrupted).then(providerStart(1))
    .expect(s.phase == "uncertain" and s.posts == Set(1) and invariant)
  run lostAcceptedOutcomeReplyKeepsSubmittedReceiptTest = init.then(started(1)).then(land(1)).then(providerResult(1, "created", true))
    .then(commitOutcome(1)).then(outcomeReply(1, "lost")).expect(s.phase == "submitted" and s.advisory == 1 and invariant)
  run missingOutcomeCountDoesNotUndoAcceptedCopyTest = init.then(started(1)).then(land(1)).then(providerResult(1, "created", true))
    .then(commitOutcome(1)).then(outcomeReply(1, "missing-count")).expect(s.phase == "submitted" and s.advisory == 1 and invariant)
  run newerOutcomeReadbackReturnsSafeFallbackTest = init.then(started(1)).then(land(1)).then(providerResult(1, "created", true))
    .then(commitOutcome(1)).then(outcomeReply(1, "ok")).then(verify).then(outcomeReadback(1, true))
    .expect(s.receiptVerified and s.senders.get(1).response == "fallback" and invariant)
  run retryListingFailureKeepsAcceptedCopyTest = init.then(started(1)).then(uncertain(1)).then(fourTicks).then(reconcileEmpty)
    .then(started(2)).then(land(1)).then(land(2)).then(providerResult(2, "created", false)).then(written(2)).then(verify)
    .expect(s.advisory == 2 and s.copies == ids and invariant)
  run laterAttemptCanHaveEarlierReceiptTimestampTest = init.then(reverseCopyOrder).then(started(1)).then(uncertain(1))
    .then(fourTicks).then(reconcileEmpty).then(started(2)).then(land(1)).then(land(2))
    .then(providerResult(2, "created", true)).then(written(2)).then(verify).expect(s.advisory == 2 and invariant)
  run lateAcceptedReplyKeepsCopyForReconciliationTest = init.then(started(1)).then(age).then(age).then(interrupted)
    .then(age).then(age).then(reconcileEmpty).then(committed(2)).then(land(1)).then(providerResult(1, "created", true))
    .then(commitOutcome(1)).then(fallbackRead(1)).then(fallbackWrite(1)).then(claimReply(2, "ok")).then(claimReadback(2, true))
    .expect(s.phase == "uncertain" and s.posts == Set(1) and s.senders.get(2).response == "stale")
    .then(reconcileFound).then(verify).expect(s.receiptVerified and s.advisory == 1 and invariant)
  run throttleReopensWithoutCopyTest = init.then(started(1)).then(providerResult(1, "throttled", true)).then(written(1))
    .expect(s.phase == "draft" and s.copies == Set() and s.attempts == 1 and invariant)
  run submittedVerificationExpiryKeepsSavedCaseTest = init.then(save).then(started(1)).then(land(1)).then(providerResult(1, "created", true))
    .then(written(1)).then(fiveTicks).then(verificationExpires).expect(s.phase == "failed" and s.terminalFailure and s.caseCount == 1 and invariant)
  run lostVerifiedReplyCannotDeleteReceiptTest = init.then(save).then(started(1)).then(land(1)).then(providerResult(1, "created", true))
    .then(written(1)).then(verify).then(loseReceiptReply).expect(s.receiptVerified and s.caseCount == 1 and invariant)
  run legacyReadbackBorrowsNewClaimNegativeControlTest = init.then(heldThenDraft).then(committed(2)).then(legacyClaimReadback(1)).then(providerStart(1))
    .expect(s.senders.get(1).usableRevision == s.senders.get(2).claimRevision and not(ownClaimOnly))
}

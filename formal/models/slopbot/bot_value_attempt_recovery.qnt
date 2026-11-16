// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-budget.ts
// @source workers/slopbot/value-consumer.ts
// @source workers/slopbot/value-processing.ts
// @source migrations/0120_slopbot_value_attempt_completion.sql
// @evidence workers/slopbot/value-pipeline.test.ts
// One key has two completed non-free attempts, an in-flight third attempt A,
// and at most two attempts by successor B. A's lease may expire before receipt,
// retention or completion. The scheduler's due action abstracts the existing
// retry delay; the model does not select that delay or forgive a reservation.
module bot_value_attempt_recovery {
  var s: { aLive: bool, aReceipt: str, aValid: bool, aRetained: bool, aComplete: bool,
    bPhase: str, bAttempt: int, bDecision: str, bReserved: bool, bCalls: int,
    bLive: bool, bDue: bool, journal: bool }
  action init = s' = { aLive: true, aReceipt: "none", aValid: false,
    aRetained: false, aComplete: false, bPhase: "unread", bAttempt: 0,
    bDecision: "none", bReserved: false, bCalls: 0, bLive: false,
    bDue: false, journal: false }
  val counted = 2 + (if (s.aReceipt == "free") 0 else 1)
    + (if (s.bReserved) 1 else 0)
  val confirmed = 2 + (if (s.aReceipt == "non-free" and s.aComplete) 1 else 0)
  action expireA = all { s.aLive, s' = s.with("aLive", false) }
  action recordA(free: bool, valid: bool): bool = all {
    s.aReceipt == "none", not(free and valid),
    s' = s.with("aReceipt", if (free) "free" else "non-free").with("aValid", valid) }
  action retainA = all { s.aReceipt == "non-free", s.aValid, not(s.aRetained),
    s' = s.with("aRetained", true) }
  action completeA = all { s.aReceipt != "none", not(s.aComplete),
    not(s.aValid) or s.aRetained, s' = s.with("aComplete", true) }
  action publishA = all { s.aLive, s.aRetained, s.aComplete,
    s' = s.with("journal", true) }
  action claimB = all { not(s.aLive), s.bAttempt < 2,
    s.bPhase == "unread" or (s.bPhase == "waiting" and s.bDue),
    s' = s.with("bPhase", "read").with("bAttempt", s.bAttempt + 1)
      .with("bDecision", "none").with("bLive", true).with("bDue", false) }
  action firstReadB = all { s.bPhase == "read",
    s' = s.with("bPhase", if (s.aRetained) "retained" else "admission") }
  action admitB = {
    val decision = if (counted < 3) "admitted"
      else if (confirmed == 3) "attempts" else "attempts-pending"
    all { s.bPhase == "admission",
      s' = s.with("bPhase", "reply").with("bDecision", decision) }
  }
  action replyB = all { s.bPhase == "reply",
    s' = s.with("bPhase", if (s.bDecision == "admitted") "reserve"
      else if (s.bDecision == "attempts") "terminal-read" else "waiting")
      .with("bLive", s.bDecision != "attempts-pending") }
  // The terminal decision reads retained results again. Completion is written
  // after retention, so a valid completed A cannot be hidden by an older read.
  action terminalReadB = all { s.bPhase == "terminal-read",
    s' = s.with("bPhase", if (s.aRetained) "retained" else "exhausted")
      .with("bLive", s.aRetained) }
  action reserveB = all { s.bPhase == "reserve", counted < 3,
    s' = s.with("bPhase", "reserved").with("bReserved", true) }
  action callB = all { s.bPhase == "reserved", s.bLive,
    s' = s.with("bPhase", "called").with("bCalls", s.bCalls + 1) }
  action publishB = all { s.bLive, s.bPhase == "retained" or s.bPhase == "called",
    s' = s.with("bPhase", "published").with("journal", true) }
  action dueB = all { s.bPhase == "waiting", not(s.bDue),
    s' = s.with("bDue", true) }
  action step = {
    nondet free = Set(false, true).oneOf()
    nondet valid = Set(false, true).oneOf()
    any { expireA, recordA(free, valid), retainA, completeA, publishA,
      claimB, firstReadB, admitB, replyB, terminalReadB, reserveB,
      callB, publishB, dueB, s' = s }
  }
  val invariant = all { counted <= 3, s.bCalls <= 1,
    s.bCalls > 0 implies (s.bReserved and s.aReceipt == "free"),
    s.aComplete and s.aValid implies s.aRetained,
    s.bPhase == "exhausted" implies (confirmed == 3 and not(s.aRetained)),
    s.bPhase == "published" implies s.journal }
  run lateFreeReceiptResumesAtRetryTest = init.then(expireA).then(claimB)
    .then(firstReadB).then(admitB).then(replyB)
    .expect(s.bPhase == "waiting" and counted == 3 and s.bCalls == 0)
    .then(recordA(true, false)).then(completeA).then(dueB).then(claimB)
    .then(firstReadB).then(admitB).then(replyB).then(reserveB).then(callB).then(publishB)
    .expect(s.bCalls == 1 and counted == 3 and s.journal and invariant)
  run pendingReceiptDoesNotChangeBeforeReplyTest = init.then(expireA).then(claimB)
    .then(firstReadB).then(admitB).then(recordA(true, false)).then(completeA).then(replyB)
    .expect(s.bPhase == "waiting" and s.bDecision == "attempts-pending" and counted == 2)
  run completedNonFreeExhaustionRemainsTerminalTest = init.then(recordA(false, false))
    .then(completeA).then(expireA).then(claimB).then(firstReadB).then(admitB)
    .then(replyB).then(terminalReadB)
    .expect(s.bPhase == "exhausted" and s.bCalls == 0 and invariant)
  run incompleteNonFreeCostDoesNotEndRequestTest = init.then(recordA(false, true))
    .then(expireA).then(claimB).then(firstReadB).then(admitB).then(replyB)
    .expect(s.bPhase == "waiting" and confirmed == 2)
    .then(retainA).then(completeA).then(dueB).then(claimB).then(firstReadB).then(publishB)
    .expect(s.bCalls == 0 and s.journal and invariant)
  run retainedBetweenReadAndAdmissionIsRecheckedTest = init.then(recordA(false, true))
    .then(expireA).then(claimB).then(firstReadB).then(retainA).then(completeA)
    .then(admitB).then(replyB).then(terminalReadB).then(publishB)
    .expect(s.bCalls == 0 and s.journal and s.bPhase == "published")
  run unknownHoldsNeverAuthorizeFourthCallTest = init.then(expireA).then(claimB)
    .then(firstReadB).then(admitB).then(replyB).then(dueB).then(claimB)
    .then(firstReadB).then(admitB).then(replyB)
    .expect(s.bPhase == "waiting" and counted == 3 and s.bCalls == 0 and invariant)
  run completionRequiresSuccessfulRetentionTest = init.then(recordA(false, true))
    .expect(not(s.aComplete) and not(s.aRetained)).then(completeA.fail())
  run oldOwnerCannotPublishRetainedResultTest = init.then(recordA(false, true))
    .then(expireA).then(retainA).then(completeA)
    .expect(s.aRetained and not(s.journal)).then(publishA.fail())
}

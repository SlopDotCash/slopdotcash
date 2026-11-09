// @source backend/points/disputes.ts
// @source backend/points/handler.ts
// @source backend/notifications/events.ts
// @source migrations/0114_points_dispute_intake.sql
// @evidence backend/points/disputes.test.ts
// Two overlapping API requests for one retained revision/dispute, optionally
// already present when the bounded invocation window starts. Actor 1 is
// its recipient (even if also configured as moderator), 2/3 are independent
// moderators and 0 is unrelated. Two reasons/outcomes and one later Points
// revision are represented. Session/body/digest validity are input predicates.
//
// Refines receipt boundaries omitted by points_dispute_intake/decision:
// atomic batch effects, lost batch reply, separate readbacks, triage dispatch,
// captured retry/detail views and transport delivery. A 500 or lost response
// does not undo an inserted dispute, final decision or its notification.
// Exact decision recovery compares outcome, resolver and reason, not outcome
// alone. Existing identical intake can recover after a later Points revision.
//
// Worker draft/escalation are subordinate committed effects; their leases,
// confidence and cost accounting belong to the dedicated worker models.
// Calling optional process() is not proof that triage ran or completed.
// GET's view state comes from its first appeal read; resolutionReason comes
// from a separate saved-source read and may already reflect a later decision.
// No action changes the award, creates a payment or automatically resolves a
// dispute. Captured authorization is not a continuous moderator/session lease.
// Authored source scenarios only; no execution or workflow result is claimed.
module points_dispute_receipts {
  val ids = Set(1, 2)
  val actors = Set(0, 1, 2, 3)
  val modes = Set("intake", "detail", "retry", "decision")
  type Request = { phase: str, mode: str, actor: int, statement: int, choice: int, reason: int,
    capturedEscalated: bool, capturedResolution: int, readResolution: int, readResolver: int,
    readReason: int, savedReason: int, view: str, response: str, received: str }
  val empty: Request = { phase: "unused", mode: "intake", actor: 1, statement: 1, choice: 1, reason: 1,
    capturedEscalated: false, capturedResolution: 0, readResolution: 0, readResolver: 0,
    readReason: 0, savedReason: 0, view: "none", response: "none", received: "none" }
  var s: { currentRevision: bool, exists: bool, statement: int, draft: int, escalated: bool,
    resolution: int, resolver: int, reason: int, openedNotice: bool, resolvedNotice: bool,
    firstStatement: int, firstResolution: int, firstResolver: int, firstReason: int,
    requests: int -> Request, dispatched: Set[int], originalAward: int, payments: int }
  action init = s' = { currentRevision: true, exists: false, statement: 0, draft: 0, escalated: false,
    resolution: 0, resolver: 0, reason: 0, openedNotice: false, resolvedNotice: false,
    firstStatement: 0, firstResolution: 0, firstResolver: 0, firstReason: 0,
    requests: ids.mapBy(_ => empty), dispatched: Set(), originalAward: 1, payments: 0 }
  action retainedAtStart = all { not(s.exists), ids.forall(id => s.requests.get(id).phase == "unused"),
    s' = s.with("exists", true).with("statement", 1).with("firstStatement", 1).with("openedNotice", true) }
  pure def viewState(escalated: bool, resolution: int): str =
    if (resolution > 0) "resolved" else if (escalated) "review" else "triage"
  pure def answer(request: Request, response: str): Request = request.with("phase", "response").with("response", response)
  action begin(id: int, mode: str, actor: int, statement: int, choice: int, reason: int, valid: bool): bool = all {
    ids.contains(id), modes.contains(mode), actors.contains(actor), ids.contains(statement), ids.contains(choice), ids.contains(reason),
    s.requests.get(id).phase == "unused",
    s' = s.with("requests", s.requests.set(id, empty.with("mode", mode).with("actor", actor)
      .with("statement", statement).with("choice", choice).with("reason", reason)
      .with("phase", if (mode == "intake" and valid) "source" else if (mode == "intake") "response" else "lookup")
      .with("response", if (mode == "intake" and not(valid)) "invalid" else "none"))) }
  action source(id: int, integrity: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "source",
      s' = s.with("requests", s.requests.set(id,
        if (not(integrity)) answer(request, "unavailable") else if (request.actor != 1) answer(request, "forbidden")
        else request.with("phase", "intake-batch"))) }
  }
  action correction = all { s.currentRevision, s' = s.with("currentRevision", false) }
  action intakeCommit(id: int): bool = {
    val request = s.requests.get(id)
    val creates = not(s.exists) and s.currentRevision
    all { request.phase == "intake-batch",
      s' = s.with("exists", s.exists or creates).with("statement", if (creates) request.statement else s.statement)
        .with("firstStatement", if (creates) request.statement else s.firstStatement)
        .with("openedNotice", s.openedNotice or creates)
        .with("requests", s.requests.set(id, request.with("phase", "batch-reply"))) }
  }
  action batchReply(id: int, delivered: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "batch-reply",
      s' = s.with("requests", s.requests.set(id,
        if (not(delivered)) answer(request, "unavailable")
        else request.with("phase", if (request.mode == "intake") "statement-read" else "decision-read"))) }
  }
  action batchFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("intake-batch", "decision-batch").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, answer(request, "unavailable"))) }
  }
  action statementRead(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "statement-read",
      s' = s.with("requests", s.requests.set(id,
        if (not(s.exists)) answer(request, "superseded") else if (s.statement != request.statement) answer(request, "already-submitted")
        else request.with("phase", "dispatch"))) }
  }
  action dispatch(id: int, configured: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "dispatch",
      s' = s.with("dispatched", if (configured) s.dispatched.union(Set(id)) else s.dispatched)
        .with("requests", s.requests.set(id, if (request.mode == "retry")
          answer(request.with("view", viewState(request.capturedEscalated, request.capturedResolution)), "accepted")
          else request.with("phase", "intake-view"))) }
  }
  action intakeView(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "intake-view", s.exists,
      s' = s.with("requests", s.requests.set(id, answer(request.with("view", viewState(s.escalated, s.resolution)), "created"))) }
  }
  action observeAppeal(id: int): bool = {
    val request = s.requests.get(id)
    val allowed = request.actor == 1 or (request.actor >= 2 and s.escalated)
    all { request.phase == "lookup",
      s' = s.with("requests", s.requests.set(id, if (not(s.exists) or not(allowed)) answer(request, "not-found")
        else request.with("capturedEscalated", s.escalated).with("capturedResolution", s.resolution).with("phase", "saved-read"))) }
  }
  action savedRead(id: int): bool = all { s.requests.get(id).phase == "saved-read",
    s' = s.with("requests", s.requests.set(id, s.requests.get(id).with("savedReason", s.reason).with("phase", "action"))) }
  // Convenience only: step keeps the two reads separate.
  action lookup(id: int): bool = observeAppeal(id).then(
    if (s.requests.get(id).phase == "saved-read") savedRead(id) else s' = s)
  action chooseAction(id: int, valid: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "action",
      s' = s.with("requests", s.requests.set(id,
        if (request.mode == "detail") answer(request.with("view", viewState(request.capturedEscalated, request.capturedResolution)), "ok")
        else if (request.mode == "retry")
          if (request.capturedResolution > 0) answer(request, "already-resolved") else request.with("phase", "dispatch")
        else if (request.actor < 2 or not(request.capturedEscalated)) answer(request, "forbidden")
        else if (not(valid)) answer(request, "invalid") else request.with("phase", "decision-batch"))) }
  }
  action decisionCommit(id: int): bool = {
    val request = s.requests.get(id)
    val writes = s.resolution == 0 and s.escalated
    all { request.phase == "decision-batch",
      s' = s.with("resolution", if (writes) request.choice else s.resolution)
        .with("resolver", if (writes) request.actor else s.resolver).with("reason", if (writes) request.reason else s.reason)
        .with("firstResolution", if (writes) request.choice else s.firstResolution)
        .with("firstResolver", if (writes) request.actor else s.firstResolver).with("firstReason", if (writes) request.reason else s.firstReason)
        .with("resolvedNotice", s.resolvedNotice or writes)
        .with("requests", s.requests.set(id, request.with("phase", "batch-reply"))) }
  }
  action decisionRead(id: int): bool = {
    val request = s.requests.get(id)
    all { request.phase == "decision-read",
      s' = s.with("requests", s.requests.set(id, request.with("readResolution", s.resolution).with("phase", "resolver-read"))) }
  }
  action resolverRead(id: int): bool = {
    val request = s.requests.get(id)
    val matches = request.readResolution == request.choice and s.resolver == request.actor and s.reason == request.reason
    all { request.phase == "resolver-read",
      s' = s.with("requests", s.requests.set(id, answer(request.with("readResolver", s.resolver).with("readReason", s.reason)
        .with("view", if (matches) "resolved" else "none"), if (matches) "ok" else "already-resolved"))) }
  }
  action readFailure(id: int): bool = {
    val request = s.requests.get(id)
    all { Set("source", "lookup", "saved-read", "action", "statement-read", "intake-view", "decision-read", "resolver-read").contains(request.phase),
      s' = s.with("requests", s.requests.set(id, answer(request, "unavailable"))) }
  }
  action workerDraft = all { s.exists, s.resolution == 0, s.draft == 0, s' = s.with("draft", 1) }
  action workerEscalate = all { s.exists, s.resolution == 0, not(s.escalated), s' = s.with("escalated", true) }
  action deliver(id: int, received: bool): bool = {
    val request = s.requests.get(id)
    all { request.phase == "response",
      s' = s.with("requests", s.requests.set(id, request.with("phase", "done")
        .with("received", if (received) request.response else "unknown"))) }
  }
  action step = {
    nondet id = ids.oneOf() nondet actor = actors.oneOf() nondet statement = ids.oneOf()
    nondet choice = ids.oneOf() nondet reason = ids.oneOf() nondet mode = modes.oneOf()
    nondet yes = Set(false, true).oneOf()
    any { retainedAtStart, begin(id, mode, actor, statement, choice, reason, yes), source(id, yes), correction,
      intakeCommit(id), batchReply(id, yes), batchFailure(id), statementRead(id), dispatch(id, yes), intakeView(id),
      observeAppeal(id), savedRead(id), chooseAction(id, yes), decisionCommit(id), decisionRead(id), resolverRead(id), readFailure(id),
      workerDraft, workerEscalate, deliver(id, yes), s' = s }
  }
  val invariant = all {
    s.statement == s.firstStatement, s.resolution == s.firstResolution, s.resolver == s.firstResolver, s.reason == s.firstReason,
    s.exists == s.openedNotice, (s.resolution > 0) == s.resolvedNotice,
    s.resolution > 0 implies s.escalated and s.resolver >= 2,
    s.originalAward == 1, s.payments == 0,
    ids.forall(id => {
      val request = s.requests.get(id)
      all { request.response == "created" implies s.exists and request.actor == 1,
        request.mode == "decision" and request.response == "ok" implies
          request.readResolution == request.choice and request.readResolver == request.actor and request.readReason == request.reason }
    }) }
  action intake(id: int): bool = begin(id, "intake", 1, 1, 1, 1, true).then(source(id, true)).then(intakeCommit(id))
  action created(id: int): bool = intake(id).then(batchReply(id, true)).then(statementRead(id)).then(dispatch(id, true)).then(intakeView(id)).then(deliver(id, true))
  action decide(id: int, actor: int, choice: int, reason: int): bool = begin(id, "decision", actor, 1, choice, reason, true)
    .then(lookup(id)).then(chooseAction(id, true)).then(decisionCommit(id))
  action decided(id: int): bool = batchReply(id, true).then(decisionRead(id)).then(resolverRead(id)).then(deliver(id, true))
  run lostIntakeBatchReplyRetainsReceiptTest = init.then(intake(1)).then(batchReply(1, false)).then(deliver(1, true))
    .then(created(2)).expect(s.exists and s.openedNotice and s.requests.get(1).received == "unavailable"
      and s.requests.get(2).received == "created" and invariant)
  run changedStatementAfterLostReplyCannotReplaceSourceTest = init.then(intake(1)).then(batchReply(1, false))
    .then(begin(2, "intake", 1, 2, 1, 1, true)).then(source(2, true)).then(intakeCommit(2)).then(batchReply(2, true)).then(statementRead(2))
    .expect(s.statement == 1 and s.requests.get(2).response == "already-submitted" and invariant)
  run correctionAfterLostReplyStillAllowsExactRecoveryTest = init.then(intake(1)).then(batchReply(1, false)).then(correction)
    .then(created(2)).expect(s.requests.get(2).received == "created" and not(s.currentRevision) and invariant)
  run correctionBeforeInsertPublishesNoReceiptTest = init.then(begin(1, "intake", 1, 1, 1, 1, true)).then(source(1, true))
    .then(correction).then(intakeCommit(1)).then(batchReply(1, true)).then(statementRead(1))
    .expect(not(s.exists) and s.requests.get(1).response == "superseded" and invariant)
  run postCommitReadFailureDoesNotEraseDisputeTest = init.then(intake(1)).then(batchReply(1, true)).then(readFailure(1))
    .expect(s.exists and s.requests.get(1).response == "unavailable" and invariant)
  run omittedProcessorStillReturnsRetainedTriageTest = init.then(intake(1)).then(batchReply(1, true)).then(statementRead(1))
    .then(dispatch(1, false)).then(intakeView(1)).expect(s.dispatched == Set() and s.requests.get(1).view == "triage" and invariant)
  run dispatchedProcessorNeedNotFinishBeforeResponseTest = init.then(created(1))
    .expect(s.dispatched == Set(1) and not(s.escalated) and s.draft == 0 and invariant)
  run processorMayEscalateBeforeIntakeViewTest = init.then(intake(1)).then(batchReply(1, true)).then(statementRead(1)).then(dispatch(1, true))
    .then(workerDraft).then(workerEscalate).then(intakeView(1)).expect(s.requests.get(1).view == "review" and invariant)
  run moderatorCannotReadUnescalatedReceiptTest = init.then(created(1)).then(begin(2, "detail", 2, 1, 1, 1, true)).then(lookup(2))
    .expect(s.requests.get(2).response == "not-found" and invariant)
  run recipientCannotDecideEvenWhenListedAsModeratorTest = init.then(created(1)).then(workerEscalate)
    .then(begin(2, "decision", 1, 1, 1, 1, true)).then(lookup(2)).then(chooseAction(2, true))
    .expect(s.requests.get(2).response == "forbidden" and s.resolution == 0 and invariant)
  run decisionLostReplyStillCreatesFinalNoticeTest = init.then(created(1)).then(workerEscalate).then(decide(2, 2, 1, 1))
    .then(batchReply(2, false)).expect(s.resolution == 1 and s.resolver == 2 and s.resolvedNotice
      and s.requests.get(2).response == "unavailable" and invariant)
  run decisionReadFailureDoesNotEraseFinalResultTest = init.then(created(1)).then(workerEscalate).then(decide(2, 2, 2, 1))
    .then(batchReply(2, true)).then(readFailure(2)).expect(s.resolution == 2 and s.resolvedNotice and invariant)
  run lostHttpReplyDoesNotEraseFinalResultTest = init.then(created(1)).then(workerEscalate).then(decide(2, 2, 1, 1))
    .then(batchReply(2, true)).then(decisionRead(2)).then(resolverRead(2)).then(deliver(2, false))
    .expect(s.requests.get(2).received == "unknown" and s.resolution == 1 and invariant)
  run exactDecisionRetryRecoversLostWriteReplyTest = init.then(retainedAtStart).then(workerEscalate)
    .then(decide(1, 2, 1, 1)).then(batchReply(1, false)).then(decide(2, 2, 1, 1)).then(decided(2))
    .expect(s.requests.get(2).received == "ok" and s.resolver == 2 and s.resolvedNotice and invariant)
  run sameOutcomeFromOtherModeratorIsNotExactRecoveryTest = init.then(retainedAtStart).then(workerEscalate)
    .then(decide(1, 2, 1, 1)).then(batchReply(1, false)).then(decide(2, 3, 1, 1)).then(decided(2))
    .expect(s.requests.get(2).received == "already-resolved" and s.resolver == 2 and invariant)
  run concurrentDecisionReadbacksKeepFirstCommitTest = init.then(retainedAtStart).then(workerEscalate)
    .then(begin(1, "decision", 2, 1, 1, 1, true)).then(lookup(1)).then(chooseAction(1, true))
    .then(decide(2, 3, 2, 2)).then(decisionCommit(1)).then(decided(1)).then(decided(2))
    .expect(s.resolution == 2 and s.resolver == 3 and s.requests.get(1).received == "already-resolved"
      and s.requests.get(2).received == "ok" and invariant)
  run admittedRetryMayReturnCapturedReviewAfterResolutionTest = init.then(retainedAtStart).then(workerEscalate)
    .then(begin(1, "retry", 1, 1, 1, 1, true)).then(lookup(1)).then(chooseAction(1, true))
    .then(decide(2, 2, 1, 1)).then(decided(2)).then(dispatch(1, true)).then(deliver(1, true))
    .expect(s.resolution == 1 and s.requests.get(1).received == "accepted" and s.requests.get(1).view == "review" and invariant)
  run detailViewRetainsReadSnapshotAcrossEscalationTest = init.then(retainedAtStart)
    .then(begin(1, "detail", 1, 1, 1, 1, true)).then(lookup(1)).then(workerEscalate).then(chooseAction(1, true))
    .expect(s.requests.get(1).view == "triage" and s.escalated and invariant)
  run detailMayPairCapturedReviewWithNewDecisionReasonTest = init.then(retainedAtStart).then(workerEscalate)
    .then(begin(1, "detail", 1, 1, 1, 1, true)).then(observeAppeal(1))
    .then(decide(2, 2, 1, 2)).then(decided(2)).then(savedRead(1)).then(chooseAction(1, true))
    .expect(s.requests.get(1).view == "review" and s.requests.get(1).capturedResolution == 0
      and s.requests.get(1).savedReason == 2 and s.resolution == 1 and invariant)
}

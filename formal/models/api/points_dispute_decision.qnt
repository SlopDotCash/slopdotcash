// @source backend/points/disputes.ts
// @source backend/notifications/events.ts
// @source migrations/0114_points_dispute_intake.sql
// One retained dispute, two requests, recipient 1 and independent moderators 2/3.
// Actor 0 is unrelated. Body grammar and captured moderator membership are classes.
// SQL decision and notification batch is atomic. Scenarios are unexecuted.
module points_dispute_decision {
  pure val requests = Set(1, 2)
  var s: { escalated: bool, resolution: int, resolver: int, reason: int,
    firstResolution: int, firstResolver: int, firstReason: int, notified: bool,
    used: Set[int], decisions: Set[int], retries: Set[int], actors: int -> int,
    choices: int -> int, reasons: int -> int, responses: int -> str,
    lastView: str, mayDecide: bool, award: int, payment: int }
  action init = s' = { escalated: false, resolution: 0, resolver: 0, reason: 0,
    firstResolution: 0, firstResolver: 0, firstReason: 0, notified: false,
    used: Set(), decisions: Set(), retries: Set(), actors: requests.mapBy(_ => 0),
    choices: requests.mapBy(_ => 0), reasons: requests.mapBy(_ => 0),
    responses: requests.mapBy(_ => "none"), lastView: "none", mayDecide: false,
    award: 1, payment: 0 }
  def mayRead(actor: int): bool = actor == 1 or (actor >= 2 and s.escalated)
  action escalate = all { not(s.escalated), s.resolution == 0, s' = s.with("escalated", true) }
  action read(actor: int): bool = all { actor >= 0, actor <= 3,
    s' = s.with("lastView", if(not(mayRead(actor))) "not_found"
      else if(s.resolution > 0) "resolved" else if(s.escalated) "review" else "triage")
      .with("mayDecide", mayRead(actor) and actor >= 2 and s.resolution == 0) }
  action prepareDecision(id: int, actor: int, choice: int, reason: int, valid: bool): bool = all {
    not(s.used.contains(id)), actor >= 0, actor <= 3, choice >= 1, choice <= 2, reason >= 1, reason <= 2,
    val outcome = if(not(mayRead(actor))) "not_found" else if(actor == 1) "forbidden"
      else if(not(valid)) "invalid" else "pending"
    s' = s.with("used", s.used.union(Set(id))).with("actors", s.actors.set(id, actor))
      .with("choices", s.choices.set(id, choice)).with("reasons", s.reasons.set(id, reason))
      .with("responses", s.responses.set(id, outcome))
      .with("decisions", if(outcome == "pending") s.decisions.union(Set(id)) else s.decisions) }
  action commitDecision(id: int, databaseWorks: bool): bool = all {
    s.decisions.contains(id),
    val write = databaseWorks and s.resolution == 0
    val choice = if(write) s.choices.get(id) else s.resolution
    val actor = if(write) s.actors.get(id) else s.resolver
    val reason = if(write) s.reasons.get(id) else s.reason
    val same = choice == s.choices.get(id) and actor == s.actors.get(id) and reason == s.reasons.get(id)
    s' = s.with("resolution", choice).with("resolver", actor).with("reason", reason)
      .with("firstResolution", if(write) choice else s.firstResolution)
      .with("firstResolver", if(write) actor else s.firstResolver)
      .with("firstReason", if(write) reason else s.firstReason)
      .with("notified", s.notified or write).with("decisions", s.decisions.exclude(Set(id)))
      .with("responses", s.responses.set(id, if(not(databaseWorks)) "error" else if(same) "ok" else "already_resolved")) }
  action prepareRetry(id: int, actor: int): bool = all {
    not(s.used.contains(id)), actor >= 0, actor <= 3,
    val outcome = if(not(mayRead(actor))) "not_found" else if(s.resolution > 0) "already_resolved" else "pending"
    s' = s.with("used", s.used.union(Set(id))).with("responses", s.responses.set(id, outcome))
      .with("retries", if(outcome == "pending") s.retries.union(Set(id)) else s.retries) }
  // Retry admission observed an unresolved row. A later response may be 202
  // after another request resolves it; the worker independently refuses that row.
  action completeRetry(id: int): bool = all { s.retries.contains(id),
    s' = s.with("retries", s.retries.exclude(Set(id))).with("responses", s.responses.set(id, "accepted")) }
  action step = {
    nondet id = requests.oneOf()
    nondet actor = Set(0, 1, 2, 3).oneOf()
    nondet choice = Set(1, 2).oneOf()
    nondet reason = Set(1, 2).oneOf()
    nondet ok = Set(false, true).oneOf()
    any { escalate, read(actor), prepareDecision(id, actor, choice, reason, ok),
      commitDecision(id, ok), prepareRetry(id, actor), completeRetry(id), s' = s }
  }
  val invariant = all {
    s.resolution == s.firstResolution, s.resolver == s.firstResolver, s.reason == s.firstReason,
    s.notified == (s.resolution > 0), s.decisions.intersect(s.retries) == Set(),
    s.decisions.union(s.retries).subseteq(s.used), s.award == 1, s.payment == 0,
    s.resolution > 0 implies(s.escalated and s.resolver >= 2 and s.reason > 0) }
  run recipientCanReadTriageTest = init.then(read(1)).expect(s.lastView == "triage" and not(s.mayDecide))
  run unrelatedActorCannotReadTest = init.then(escalate).then(read(0)).expect(s.lastView == "not_found")
  run moderatorCannotReadBeforeEscalationTest = init.then(read(2)).expect(s.lastView == "not_found")
  run independentModeratorCanReadReviewTest = init.then(escalate).then(read(2)).expect(s.lastView == "review" and s.mayDecide)
  run recipientCannotDecideOwnDisputeTest = init.then(escalate).then(prepareDecision(1, 1, 1, 1, true))
    .expect(s.responses.get(1) == "forbidden" and s.resolution == 0)
  run decisionRequiresEscalationTest = init.then(prepareDecision(1, 2, 1, 1, true))
    .expect(s.responses.get(1) == "not_found" and s.resolution == 0)
  run malformedDecisionDoesNotWriteTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, false))
    .expect(s.responses.get(1) == "invalid" and s.resolution == 0)
  run decisionFailureDoesNotNotifyTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(commitDecision(1, false)).expect(s.responses.get(1) == "error" and not(s.notified))
  run firstModeratorCommitWinsTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(prepareDecision(2, 3, 2, 2, true)).then(commitDecision(2, true)).then(commitDecision(1, true))
    .expect(s.resolution == 2 and s.resolver == 3 and s.reason == 2 and s.responses.get(1) == "already_resolved")
  run identicalDecisionRetryIsIdempotentTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(commitDecision(1, true)).then(prepareDecision(2, 2, 1, 1, true)).then(commitDecision(2, true))
    .expect(s.responses.get(2) == "ok" and s.notified and s.resolver == 2)
  run matchingOutcomeFromAnotherModeratorConflictsTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(commitDecision(1, true)).then(prepareDecision(2, 3, 1, 1, true)).then(commitDecision(2, true))
    .expect(s.responses.get(2) == "already_resolved" and s.resolver == 2)
  run changedReasonCannotReplaceDecisionTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(commitDecision(1, true)).then(prepareDecision(2, 2, 1, 2, true)).then(commitDecision(2, true))
    .expect(s.responses.get(2) == "already_resolved" and s.reason == 1)
  run resolvedReadRemovesDecisionControlTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(commitDecision(1, true)).then(read(2)).expect(s.lastView == "resolved" and not(s.mayDecide))
  run recipientCanRetryBeforeEscalationTest = init.then(prepareRetry(1, 1)).then(completeRetry(1))
    .expect(s.responses.get(1) == "accepted" and s.resolution == 0)
  run resolvedDisputeRefusesNewRetryTest = init.then(escalate).then(prepareDecision(1, 2, 1, 1, true))
    .then(commitDecision(1, true)).then(prepareRetry(2, 1)).expect(s.responses.get(2) == "already_resolved")
  run admittedRetryMayCompleteAfterResolutionTest = init.then(escalate).then(prepareRetry(1, 1))
    .then(prepareDecision(2, 2, 1, 1, true)).then(commitDecision(2, true)).then(completeRetry(1))
    .expect(s.responses.get(1) == "accepted" and s.resolution == 1 and s.award == 1 and s.payment == 0)
}

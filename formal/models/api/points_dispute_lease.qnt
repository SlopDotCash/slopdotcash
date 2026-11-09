// @source workers/slopbot/points-disputes.ts
// @source workers/slopbot/appeals.ts
// @source backend/points/disputes.ts
// @source backend/notifications/events.ts
// @source migrations/0114_points_dispute_intake.sql
// One retained dispute, two unique worker claims and one independent moderator.
// SQL batches are atomic; expiry is the timestamp bound into each statement.
// Intake grammar, provider billing truth and clock-read-to-SQL delays are separate.
// Source-authored scenarios are unexecuted.
module points_dispute_lease {
  pure val workers = Set(1, 2)
  var s: { owner: int, expired: bool, phase: int -> str, verdict: int -> int, admitted: int -> bool,
    calls: Set[int], costs: Set[int], draft: int, firstDraft: int,
    confidence: int, escalated: bool, moderatorNotice: bool,
    resolution: int, resolver: int, resolvedNotice: bool, originalAward: int }
  action init = s' = { owner: 0, expired: false,
    phase: workers.mapBy(_ => "idle"), verdict: workers.mapBy(_ => 0),
    admitted: workers.mapBy(_ => false),
    calls: Set(), costs: Set(), draft: 0, firstDraft: 0, confidence: 0,
    escalated: false, moderatorNotice: false, resolution: 0, resolver: 0,
    resolvedNotice: false, originalAward: 1 }
  def owns(w: int): bool = s.owner == w and not(s.expired) and s.resolution == 0
  action claim(w: int): bool = all {
    s.phase.get(w) == "idle", s.resolution == 0,
    not(s.escalated and s.draft > 0), s.owner == 0 or s.expired,
    s' = s.with("owner", w).with("expired", false)
      .with("phase", s.phase.set(w, "read")) }
  action expire = all { s.owner > 0, not(s.expired), s' = s.with("expired", true) }
  // Re-read the immutable draft after claiming, then inspect current project/access.
  action preflight(w: int, available: bool): bool = all {
    s.phase.get(w) == "read",
    s' = s.with("phase", s.phase.set(w,
      if(s.resolution > 0) "cleanup"
      else if(not(available) or s.draft > 0) "escalate" else "send")) }
  // mayWrite is observed before the awaited scope read. That read can outlive
  // the lease; a started provider call still cannot authorize later SQL writes.
  action observeLease(w: int): bool = all { s.phase.get(w) == "send",
    s' = s.with("admitted", s.admitted.set(w, owns(w)))
      .with("phase", s.phase.set(w, "scope")) }
  action send(w: int, scope: bool): bool = all {
    s.phase.get(w) == "scope",
    s' = if(s.admitted.get(w) and scope) s.with("phase", s.phase.set(w, "waiting"))
      .with("calls", s.calls.union(Set(w)))
      else s.with("phase", s.phase.set(w, "escalate")) }
  // Returned calls are accounted before the worker rechecks ownership. A failed
  // cost write propagates and does not masquerade as a successful escalation.
  action reply(w: int, verdict: int, costsWritten: bool): bool = all {
    s.phase.get(w) == "waiting", verdict >= 0, verdict <= 2,
    s' = s.with("verdict", s.verdict.set(w, verdict))
      .with("costs", if(costsWritten) s.costs.union(Set(w)) else s.costs)
      .with("phase", s.phase.set(w, if(not(costsWritten)) "cleanup"
        else if(verdict == 0) "escalate" else "record")) }
  action record(w: int): bool = all {
    s.phase.get(w) == "record",
    val write = owns(w) and s.draft == 0
    s' = s.with("draft", if(write) s.verdict.get(w) else s.draft)
      .with("firstDraft", if(write) s.verdict.get(w) else s.firstDraft)
      .with("confidence", if(write) 89 else s.confidence)
      .with("phase", s.phase.set(w, "escalate")) }
  // Unavailable context or inference still escalates; the model never resolves.
  action escalate(w: int): bool = all {
    s.phase.get(w) == "escalate",
    s' = s.with("escalated", s.escalated or owns(w))
      .with("moderatorNotice", s.moderatorNotice or owns(w))
      .with("phase", s.phase.set(w, "cleanup")) }
  // A stale completion cannot clear a replacement claim. Resolved rows cannot
  // be changed even to clear an old claim; the retained claim grants no authority.
  action cleanup(w: int): bool = all {
    s.phase.get(w) == "cleanup",
    val clear = s.owner == w and s.resolution == 0
    s' = s.with("owner", if(clear) 0 else s.owner)
      .with("expired", if(clear) false else s.expired)
      .with("phase", s.phase.set(w, "done")) }
  action decide(actor: int, result: int): bool = all {
    s.escalated, s.resolution == 0, actor == 2, result >= 1, result <= 2,
    s' = s.with("resolution", result).with("resolver", actor).with("resolvedNotice", true) }
  action step = {
    nondet w = workers.oneOf()
    nondet verdict = Set(0, 1, 2).oneOf()
    nondet ok = Set(false, true).oneOf()
    any { claim(w), expire, preflight(w, ok), observeLease(w), send(w, ok), reply(w, verdict, ok),
      record(w), escalate(w), cleanup(w), decide(1, 1), decide(2, 1), decide(2, 2), s' = s }
  }
  val invariant = all {
    s.owner >= 0, s.owner <= 2, s.draft == s.firstDraft, s.confidence <= 89,
    (s.draft == 0) == (s.confidence == 0), s.originalAward == 1,
    s.costs.subseteq(s.calls), s.escalated == s.moderatorNotice,
    s.resolution > 0 implies(s.resolver == 2 and s.escalated and s.resolvedNotice) }
  run unavailableProjectEscalatesWithoutCallTest = init.then(claim(1)).then(preflight(1, false))
    .then(escalate(1)).then(cleanup(1)).expect(s.escalated and s.calls == Set() and s.owner == 0)
  run liveClaimRefusesConcurrentWorkerTest = init.then(claim(1)).expect(s.owner == 1).then(claim(2).fail())
  run expiredClaimCanBeReplacedTest = init.then(claim(1)).then(expire).then(claim(2)).expect(s.owner == 2 and not(s.expired))
  run staleCleanupKeepsReplacementTest = init.then(claim(1)).then(preflight(1, false)).then(expire)
    .then(claim(2)).then(escalate(1)).then(cleanup(1)).expect(s.owner == 2 and not(s.escalated))
  run expiredWorkerCannotDraftTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(expire).then(reply(1, 1, true)).then(record(1)).then(escalate(1)).then(cleanup(1))
    .expect(s.draft == 0 and not(s.escalated) and s.costs == Set(1))
  run staleReturnedCallStillHasCostRecordTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(expire).then(claim(2)).then(reply(1, 1, true)).then(record(1)).then(escalate(1)).then(cleanup(1))
    .expect(s.owner == 2 and s.costs == Set(1) and s.draft == 0)
  run failedCostWriteDoesNotEscalateTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(reply(1, 1, false)).then(cleanup(1)).expect(s.costs == Set() and not(s.escalated) and s.owner == 0)
  run deniedInferenceEscalatesTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(reply(1, 0, true)).then(escalate(1)).then(cleanup(1)).expect(s.escalated and s.draft == 0)
  run returnedDraftCannotResolveTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(reply(1, 1, true)).then(record(1)).then(escalate(1)).then(cleanup(1))
    .expect(s.draft == 1 and s.confidence == 89 and s.resolution == 0)
  run savedDraftResumesWithoutSecondCallTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(reply(1, 1, true)).then(record(1)).then(expire).then(claim(2)).then(preflight(2, true))
    .then(escalate(2)).then(cleanup(2)).expect(s.draft == 1 and s.calls == Set(1) and s.escalated)
  run completedDraftEscalationNeedsNoNewLeaseTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, true))
    .then(reply(1, 1, true)).then(record(1)).then(escalate(1)).then(cleanup(1))
    .expect(s.escalated and s.draft == 1).then(claim(2).fail())
  run sourceRestrictionBeforeSendEscalatesTest = init.then(claim(1)).then(preflight(1, true)).then(observeLease(1)).then(send(1, false))
    .then(escalate(1)).then(cleanup(1)).expect(s.calls == Set() and s.escalated)
  run selfResolutionRefusesTest = init.then(claim(1)).then(preflight(1, false)).then(escalate(1))
    .expect(s.resolution == 0).then(decide(1, 1).fail())
  run resolvedDisputeStopsOldWorkerTest = init.then(claim(1)).then(preflight(1, false)).then(escalate(1))
    .then(decide(2, 1)).then(cleanup(1))
    .expect(s.resolution == 1 and s.owner == 1 and s.originalAward == 1).then(claim(2).fail())
  run firstResolutionIsPermanentTest = init.then(claim(1)).then(preflight(1, false)).then(escalate(1))
    .then(decide(2, 2)).expect(s.resolution == 2 and s.originalAward == 1).then(decide(2, 1).fail())
  run leaseLostDuringScopeReadCanStartCallTest = init.then(claim(1)).then(preflight(1, true))
    .then(observeLease(1)).then(expire).then(claim(2)).then(send(1, true))
    .then(reply(1, 1, true)).then(record(1)).then(escalate(1)).then(cleanup(1))
    .expect(s.calls == Set(1) and s.costs == Set(1) and s.owner == 2 and s.draft == 0)
}
